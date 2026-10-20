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

// Errors that are routine/transient during normal continuous listening (a pause
// in speech, a momentary audio-session interruption) — worth an automatic retry.
// Everything else (permission, network, config problems) is surfaced instead,
// since silently retrying those just loops forever with no feedback.
const TRANSIENT_ERROR_CODES = new Set(['interrupted', 'no-speech', 'speech-timeout', 'busy']);

const RECENT_TURNS_LIMIT = 15; // chat-context window sent with each request
const EXCHANGE_THRESHOLD = 15; // how many exchanges accumulate before summarizing
const SPEAKING_SAFETY_TIMEOUT_MS = 20000;
const GOODBYE_REPLY = '再见！';
const ERROR_FALLBACK_REPLY = "Sorry, I'm having trouble connecting, let's try again.";

// Any known word whose hanzi appears anywhere in the given turns' text —
// simple substring matching, no word segmentation needed for this purpose.
function findTouchedHanzi(turns: ChatMessage[], learned: LearnedChar[]): string[] {
  const text = turns.map((t) => t.content).join(' ');
  return learned.map((c) => resolveCharacterDisplay(c).hanzi).filter((hanzi) => text.includes(hanzi));
}

export async function summarizeAndUpdateMemory(
  recentTurns: ChatMessage[],
  currentMemory: string,
  touchedHanzi: string[]
): Promise<{ memory: string; notes: { hanzi: string; note: string }[] }> {
  const transcript = recentTurns.map((t) => `${t.role}: ${t.content}`).join('\n');
  const prompt = `Here is a recent stretch of a Mandarin-tutoring conversation:\n${transcript}\n\nCurrent memory of this learner: ${currentMemory || '(nothing yet)'}\n\nWords touched in this stretch: ${touchedHanzi.join(', ') || '(none)'}\n\nRespond with json in exactly this shape: {"memory": "<updated, still-concise summary of topics covered, corrections made, and words the learner struggled with — fold in what's new, keep it bounded, don't just append>", "notes": [{"hanzi": "<one of the touched words>", "note": "<short read on how well the learner knows it>"}]}`;

  try {
    const raw = await chatComplete([{ role: 'user', content: prompt }], { json: true });
    const parsed = JSON.parse(raw);
    return {
      memory: typeof parsed.memory === 'string' ? parsed.memory : currentMemory,
      notes: Array.isArray(parsed.notes) ? parsed.notes : [],
    };
  } catch {
    return { memory: currentMemory, notes: [] };
  }
}

export function useTalkSession() {
  const { state, addConversationWord, updateNotes, updateTalkMemory } = useAppState();
  const [callState, setCallState] = useState<TalkState>('idle');
  const [transcriptLog, setTranscriptLog] = useState<{ role: 'user' | 'assistant'; text: string }[]>([]);

  const recentTurnsRef = useRef<ChatMessage[]>([]);
  // Separate from recentTurnsRef (which is trimmed to RECENT_TURNS_LIMIT for chat
  // context): accumulates every turn since the last memory summary, uncapped,
  // cleared after each summary — otherwise a summary only ever sees a fraction
  // of the exchanges it was supposed to cover.
  const turnsSinceSummaryRef = useRef<ChatMessage[]>([]);
  const callActiveRef = useRef(false);
  const busyRef = useRef(false); // true while a request is in flight or a reply is playing
  const generationRef = useRef(0); // bumped on start/end so stale async work can detect it's stale
  const stateRef = useRef(state);
  useEffect(() => {
    stateRef.current = state;
  });

  // Forward refs: handleTranscript needs start/stop, but those only exist once
  // useSpeechRecognition(handleTranscript) has been called below.
  const startRef = useRef<() => void>(() => {});
  const stopRef = useRef<() => void>(() => {});

  const exchangeCountRef = useRef(0);
  const runMemoryUpdate = useCallback(() => {
    const turns = turnsSinceSummaryRef.current;
    if (turns.length === 0) return;
    turnsSinceSummaryRef.current = [];
    const touched = findTouchedHanzi(turns, stateRef.current.learned);
    summarizeAndUpdateMemory(turns, stateRef.current.talkMemory, touched).then(({ memory, notes }) => {
      updateTalkMemory(memory);
      for (const note of notes) {
        const entry = stateRef.current.learned.find((c) => resolveCharacterDisplay(c).hanzi === note.hanzi);
        if (entry) updateNotes(entry.id, note.note);
      }
    });
  }, [updateNotes, updateTalkMemory]);
  const triggerMemoryUpdateIfDue = useCallback(() => {
    exchangeCountRef.current += 1;
    if (exchangeCountRef.current >= EXCHANGE_THRESHOLD) {
      exchangeCountRef.current = 0;
      runMemoryUpdate();
    }
  }, [runMemoryUpdate]);
  const flushMemoryUpdate = useCallback(() => {
    exchangeCountRef.current = 0;
    runMemoryUpdate();
  }, [runMemoryUpdate]);

  const speakingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clearSpeakingTimeout = useCallback(() => {
    if (speakingTimeoutRef.current) {
      clearTimeout(speakingTimeoutRef.current);
      speakingTimeoutRef.current = null;
    }
  }, []);

  const handleTranscript = useCallback(
    (transcript: string) => {
      if (!transcript.trim()) return;
      if (busyRef.current) return; // a reply is already in flight/playing — ignore overlapping input

      if (isGoodbye(transcript)) {
        callActiveRef.current = false;
        generationRef.current += 1;
        stopRef.current();
        flushMemoryUpdate();
        setCallState('idle');
        speak(GOODBYE_REPLY, { rate: 0.75 });
        return;
      }

      // Pause recognition while we think/speak — continuous mode would otherwise
      // keep listening through the reply and could pick up the TTS audio itself.
      busyRef.current = true;
      stopRef.current();
      setTranscriptLog((prev) => [...prev, { role: 'user', text: transcript }]);
      const userMessage: ChatMessage = { role: 'user', content: transcript };
      recentTurnsRef.current = [...recentTurnsRef.current, userMessage].slice(-RECENT_TURNS_LIMIT);
      turnsSinceSummaryRef.current = [...turnsSinceSummaryRef.current, userMessage];
      setCallState('thinking');

      const messages: ChatMessage[] = [
        {
          role: 'system',
          content: `${SYSTEM_PROMPT}\n\nKnown words: ${knownWordsBlock(stateRef.current.learned)}\n\nWhat you remember about this learner so far: ${stateRef.current.talkMemory || '(nothing yet)'}`,
        },
        ...recentTurnsRef.current,
      ];

      const requestGeneration = generationRef.current;
      const resumeListening = () => {
        clearSpeakingTimeout();
        busyRef.current = false;
        if (requestGeneration !== generationRef.current || !callActiveRef.current) return;
        setCallState('listening');
        startRef.current();
      };

      chatComplete(messages)
        .then((reply) => {
          if (requestGeneration !== generationRef.current) return; // call ended/restarted while this was in flight
          const { cleanText, newWords } = parseNewWordTags(reply);
          for (const word of newWords) addConversationWord(word);
          setTranscriptLog((prev) => [...prev, { role: 'assistant', text: cleanText }]);
          const assistantMessage: ChatMessage = { role: 'assistant', content: reply };
          recentTurnsRef.current = [...recentTurnsRef.current, assistantMessage].slice(-RECENT_TURNS_LIMIT);
          turnsSinceSummaryRef.current = [...turnsSinceSummaryRef.current, assistantMessage];
          triggerMemoryUpdateIfDue();
          setCallState('speaking');
          speakingTimeoutRef.current = setTimeout(resumeListening, SPEAKING_SAFETY_TIMEOUT_MS);
          speak(cleanText, { rate: 0.75, onSettled: resumeListening });
        })
        .catch(() => {
          if (requestGeneration !== generationRef.current) return;
          setCallState('speaking');
          speakingTimeoutRef.current = setTimeout(resumeListening, SPEAKING_SAFETY_TIMEOUT_MS);
          speak(ERROR_FALLBACK_REPLY, { rate: 0.75, onSettled: resumeListening });
        });
    },
    [addConversationWord, clearSpeakingTimeout, flushMemoryUpdate, triggerMemoryUpdateIfDue]
  );

  const { start, stop, error, listening } = useSpeechRecognition(handleTranscript);
  useEffect(() => {
    startRef.current = start;
    stopRef.current = stop;
  }, [start, stop]);

  // Errors from the recognizer. Transient ones (a pause, an iOS audio-session
  // interruption like a phone call) get an automatic retry. Anything else
  // (permission, network, config) is surfaced instead of silently looping —
  // see TRANSIENT_ERROR_CODES.
  useEffect(() => {
    if (!error) return;
    Speech.stop();
    if (callActiveRef.current && TRANSIENT_ERROR_CODES.has(error.code)) {
      setCallState('listening');
      startRef.current();
    } else {
      callActiveRef.current = false;
      setCallState('idle');
    }
  }, [error]);

  // The recognizer can also stop on its own without an error event. If it was
  // actively listening and silently drops while we still expect it to be
  // listening, restart — but only on that true->false edge, not on every
  // render where `listening` just hasn't caught up to a deliberate start()
  // yet (which would otherwise double-fire start() on every call/turn).
  const wasListeningRef = useRef(false);
  useEffect(() => {
    const wasListening = wasListeningRef.current;
    wasListeningRef.current = listening;
    if (wasListening && !listening && callActiveRef.current && callState === 'listening') {
      startRef.current();
    }
  }, [listening, callState]);

  const startCall = useCallback(() => {
    callActiveRef.current = true;
    busyRef.current = false;
    generationRef.current += 1;
    exchangeCountRef.current = 0;
    recentTurnsRef.current = [];
    turnsSinceSummaryRef.current = [];
    setTranscriptLog([]);
    setCallState('listening');
    start();
  }, [start]);

  const endCall = useCallback(() => {
    callActiveRef.current = false;
    busyRef.current = false;
    generationRef.current += 1; // invalidate any in-flight request's eventual reply
    clearSpeakingTimeout();
    stop();
    Speech.stop();
    flushMemoryUpdate();
    setCallState('idle');
  }, [stop, clearSpeakingTimeout, flushMemoryUpdate]);

  return { callState, transcriptLog, startCall, endCall, error: error?.message ?? null };
}
