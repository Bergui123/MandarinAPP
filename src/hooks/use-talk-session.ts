import { useCallback, useEffect, useRef, useState } from 'react';
import * as Speech from 'expo-speech';

import { useAppState } from '@/hooks/use-app-state';
import { useSpeechRecognition } from '@/hooks/use-speech-recognition';
import { ChatMessage, chatComplete } from '@/lib/deepseek';
import { LearnedChar, resolveCharacterDisplay } from '@/lib/progress';
import { speak } from '@/lib/speech';

export type TalkState = 'idle' | 'listening' | 'thinking' | 'speaking';

const SYSTEM_PROMPT = `You are a patient, friendly Mandarin tutor having a spoken phone conversation with a beginner learner.
- Speak mostly in Mandarin, slowly, in short sentences (one or two sentences per turn) — this is spoken aloud, not read.
- Mostly use words from the learner's known-word list below.
- Occasionally introduce a new word, at a random and unforced pace — not every turn.
- When you introduce a word that is NOT already in the learner's known-word list, wrap it inline exactly like this: ⟦hanzi|pinyin|meaning⟧ at the point you use it in the sentence. Never wrap a word that is already in the known-word list.
- If the learner asks a question, or clearly needs help understanding something, answer or explain in English.`;

function knownWordsBlock(learned: LearnedChar[]): string {
  return learned.map((c) => resolveCharacterDisplay(c).hanzi).join(', ');
}

export function parseNewWordTags(reply: string): {
  cleanText: string;
  newWords: { hanzi: string; pinyin: string; meaning: string }[];
} {
  const pattern = /⟦([^|⟧]+)\|([^|⟧]+)\|([^⟧]+)⟧/g;
  const newWords: { hanzi: string; pinyin: string; meaning: string }[] = [];
  const cleanText = reply.replace(pattern, (_match, hanzi, pinyin, meaning) => {
    newWords.push({ hanzi, pinyin, meaning });
    return hanzi;
  });
  return { cleanText, newWords };
}

const GOODBYE_PATTERN = /再见|拜拜|goodbye|bye|结束|end call/i;

// Intentionally imprecise — a mid-sentence mention of one of these words is a
// known false positive. The manual End button in talk.tsx is the reliable path.
export function isGoodbye(transcript: string): boolean {
  return GOODBYE_PATTERN.test(transcript);
}

const RECENT_TURNS_LIMIT = 15;
const GOODBYE_REPLY = '再见！';
const ERROR_FALLBACK_REPLY = "Sorry, I'm having trouble connecting, let's try again.";

export function useTalkSession() {
  const { state, addConversationWord } = useAppState();
  const [callState, setCallState] = useState<TalkState>('idle');
  const [transcriptLog, setTranscriptLog] = useState<{ role: 'user' | 'assistant'; text: string }[]>([]);

  const recentTurnsRef = useRef<ChatMessage[]>([]);
  const callActiveRef = useRef(false);
  const stateRef = useRef(state);
  useEffect(() => {
    stateRef.current = state;
  });

  // Forward refs: handleTranscript needs start/stop, but those only exist once
  // useSpeechRecognition(handleTranscript) has been called below.
  const startRef = useRef<() => void>(() => {});
  const stopRef = useRef<() => void>(() => {});

  // Exchange counter + flush hook for Task 7's periodic memory/notes summarization.
  // Wired in Task 7 — a no-op here keeps this task's own contract (callState,
  // transcriptLog, startCall, endCall) complete and independently testable.
  const exchangeCountRef = useRef(0);
  const triggerMemoryUpdateIfDue = useCallback(() => {
    exchangeCountRef.current += 1;
    // wired in Task 7
  }, []);
  const flushMemoryUpdate = useCallback(() => {
    // wired in Task 7
  }, []);

  const handleTranscript = useCallback(
    (transcript: string) => {
      if (!transcript.trim()) return;

      if (isGoodbye(transcript)) {
        callActiveRef.current = false;
        stopRef.current();
        flushMemoryUpdate();
        setCallState('idle');
        speak(GOODBYE_REPLY, { rate: 0.75 });
        return;
      }

      // Pause recognition while we think/speak — continuous mode would otherwise
      // keep listening through the reply and could pick up the TTS audio itself.
      stopRef.current();
      setTranscriptLog((prev) => [...prev, { role: 'user', text: transcript }]);
      const userMessage: ChatMessage = { role: 'user', content: transcript };
      recentTurnsRef.current = [...recentTurnsRef.current, userMessage].slice(-RECENT_TURNS_LIMIT);
      setCallState('thinking');

      const messages: ChatMessage[] = [
        {
          role: 'system',
          content: `${SYSTEM_PROMPT}\n\nKnown words: ${knownWordsBlock(stateRef.current.learned)}\n\nWhat you remember about this learner so far: ${stateRef.current.talkMemory || '(nothing yet)'}`,
        },
        ...recentTurnsRef.current,
      ];

      const resumeListening = () => {
        if (!callActiveRef.current) return;
        setCallState('listening');
        startRef.current();
      };

      chatComplete(messages)
        .then((reply) => {
          const { cleanText, newWords } = parseNewWordTags(reply);
          for (const word of newWords) addConversationWord(word);
          setTranscriptLog((prev) => [...prev, { role: 'assistant', text: cleanText }]);
          const assistantMessage: ChatMessage = { role: 'assistant', content: reply };
          recentTurnsRef.current = [...recentTurnsRef.current, assistantMessage].slice(-RECENT_TURNS_LIMIT);
          triggerMemoryUpdateIfDue();
          setCallState('speaking');
          speak(cleanText, { rate: 0.75, onDone: resumeListening });
        })
        .catch(() => {
          setCallState('speaking');
          speak(ERROR_FALLBACK_REPLY, { rate: 0.75, onDone: resumeListening });
        });
    },
    [addConversationWord, flushMemoryUpdate, triggerMemoryUpdateIfDue]
  );

  const { start, stop, error } = useSpeechRecognition(handleTranscript);
  useEffect(() => {
    startRef.current = start;
    stopRef.current = stop;
  }, [start, stop]);

  // Audio interruptions (e.g. an incoming phone call) surface as an 'error'
  // event from the recognizer (error code "interrupted" on iOS — see Task 1's
  // ledger notes). Stop any playback/listening; if the call is still active,
  // best-effort retry listening. The library exposes no distinct "interruption
  // ended" event, so this is a retry rather than a precise resume.
  useEffect(() => {
    if (!error) return;
    Speech.stop();
    if (callActiveRef.current) {
      setCallState('listening');
      startRef.current();
    } else {
      setCallState('idle');
    }
  }, [error]);

  const startCall = useCallback(() => {
    callActiveRef.current = true;
    exchangeCountRef.current = 0;
    recentTurnsRef.current = [];
    setTranscriptLog([]);
    setCallState('listening');
    start();
  }, [start]);

  const endCall = useCallback(() => {
    callActiveRef.current = false;
    stop();
    Speech.stop();
    flushMemoryUpdate();
    setCallState('idle');
  }, [stop, flushMemoryUpdate]);

  return { callState, transcriptLog, startCall, endCall };
}
