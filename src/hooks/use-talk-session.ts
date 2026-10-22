import { useCallback, useEffect, useRef, useState } from 'react';

import { useAppState } from '@/hooks/use-app-state';
import { useSpeechRecognition } from '@/hooks/use-speech-recognition';
import { getContextSignals } from '@/lib/context-signals';
import { ChatMessage, chatComplete, chatCompleteStream } from '@/lib/deepseek';
import { enqueueElevenLabsSpeech, speakWithElevenLabs, stopElevenLabsSpeech } from '@/lib/elevenlabs-speech';
import { SPEECH_LOCALE } from '@/lib/language-locale';
import { Difficulty, Language, LearnedChar, resolveCharacterDisplay, SessionPlan } from '@/lib/progress';

export type TalkState = 'idle' | 'listening' | 'thinking' | 'speaking';
export type SessionPlanDraft = { focusWords: string[]; topics: string[]; goal: string };
const SPEECH_RATE = 0.75; // slower, easier to follow while learning

const LANGUAGE_NAME: Record<Language, string> = { zh: 'Mandarin', fr: 'French' };
const DIFFICULTY_GUIDANCE: Record<Difficulty, string> = {
  review: 'The learner asked for a review-focused session: stick almost entirely to already-known words, introduce new vocabulary rarely if at all.',
  balanced: 'The learner asked for a balanced session: mostly known words, with new vocabulary introduced at the normal unforced pace.',
  challenge: 'The learner asked for a challenging session: push new vocabulary and slightly more complex sentences more often than usual, while staying within a beginner’s reach.',
};

function systemPrompt(lang: Language, difficulty: Difficulty): string {
  const name = LANGUAGE_NAME[lang];
  return `You are a patient, friendly ${name} tutor having a spoken phone conversation with a beginner learner.
- Speak mostly in ${name}, slowly, in ONE short sentence per turn — this is spoken aloud in a moving car, not read. Never more than one sentence unless the learner explicitly asks for a longer explanation.
- Mostly use words from the learner's known-word list below.
- Occasionally introduce a new word, at a random and unforced pace — not every turn.
- ${DIFFICULTY_GUIDANCE[difficulty]}
- When you introduce a word that is NOT already in the learner's known-word list, wrap it inline exactly like this: ⟦word|pronunciation|meaning⟧ at the point you use it in the sentence. Never wrap a word that is already in the known-word list.
- If the learner mispronounces or misuses a known word, or makes a grammar mistake, gently give the correct form in the same sentence before continuing — don't just move on as if it were right.
- You're given the learner's current time, weather, and rest-of-day schedule below. Occasionally weave one of these into a question or remark, at the same random, unforced pace as new vocabulary — not every turn, and never more than one of them in the same turn.
- If the learner asks a question, or clearly needs help understanding something, answer or explain in English.
- If you don't understand what the learner said (it may be a mis-transcription), ask ONE brief, calm clarifying question — never guess repeatedly or stack several guesses in one turn.`;
}

function knownWordsBlock(learned: LearnedChar[], lang: Language): string {
  return learned.map((c) => resolveCharacterDisplay(c, lang).hanzi).join(', ');
}

function planBlock(plan: SessionPlanDraft | null): string {
  if (!plan || (!plan.goal && plan.focusWords.length === 0 && plan.topics.length === 0)) return '(no plan set)';
  return `Goal: ${plan.goal || '(none)'}. Focus words: ${plan.focusWords.join(', ') || '(none)'}. Topics: ${plan.topics.join(', ') || '(none)'}.`;
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

// As streamed tokens accumulate, cuts off complete sentences one at a time so
// each can be sent to TTS immediately instead of waiting for the full reply.
// Skips a sentence-ending punctuation mark while inside an unclosed ⟦...⟧ tag
// (bracket count unbalanced up to that point) so a tag's content never splits.
export function extractCompleteSentences(buffer: string): { sentences: string[]; rest: string } {
  const sentences: string[] = [];
  let rest = buffer;
  const enderRegex = /[。！？.!?]/g;
  for (;;) {
    enderRegex.lastIndex = 0;
    let match: RegExpExecArray | null;
    let cut = -1;
    while ((match = enderRegex.exec(rest))) {
      const char = match[0];
      const endIdx = match.index + 1;
      // '.' may be the start of an ellipsis ("...") still arriving token-by-token.
      // Skip past a dot that's followed by another dot, and hold off cutting on
      // a lone trailing dot until more text confirms it isn't one — otherwise an
      // ellipsis gets sliced into several near-empty, stuttery TTS fragments.
      if (char === '.' && rest[endIdx] === '.') continue;
      if (char === '.' && endIdx === rest.length) break;
      const prefix = rest.slice(0, endIdx);
      const openCount = (prefix.match(/⟦/g) ?? []).length;
      const closeCount = (prefix.match(/⟧/g) ?? []).length;
      if (openCount === closeCount) {
        cut = endIdx;
        break;
      }
    }
    if (cut === -1) break;
    sentences.push(rest.slice(0, cut));
    rest = rest.slice(cut);
  }
  return { sentences, rest };
}

const GOODBYE_PATTERN: Record<Language, RegExp> = {
  zh: /再见|拜拜|goodbye|bye|结束|end call/i,
  fr: /au revoir|\bbye\b|goodbye|end call/i,
};
const GOODBYE_REPLY: Record<Language, string> = { zh: '再见！', fr: 'Au revoir !' };

// Intentionally imprecise — a mid-sentence mention of one of these words is a
// known false positive. The manual End button in talk.tsx is the reliable path.
export function isGoodbye(transcript: string, lang: Language): boolean {
  return GOODBYE_PATTERN[lang].test(transcript);
}

// Errors that are routine/transient during normal continuous listening (a pause
// in speech, a momentary audio-session interruption) — worth an automatic retry.
// Everything else (permission, network, config problems) is surfaced instead,
// since silently retrying those just loops forever with no feedback.
const TRANSIENT_ERROR_CODES = new Set(['interrupted', 'no-speech', 'speech-timeout', 'busy']);

const RECENT_TURNS_LIMIT = 15; // chat-context window sent with each request
const EXCHANGE_THRESHOLD = 15; // how many exchanges accumulate before summarizing
const SPEAKING_SAFETY_TIMEOUT_MS = 20000;
const ERROR_FALLBACK_REPLY = "Sorry, I'm having trouble connecting, let's try again.";
const MAX_CONTEXTUAL_STRINGS = 100; // SFSpeechRecognitionRequest.contextualStrings isn't meant for huge lists

// Any known word whose hanzi appears anywhere in the given turns' text —
// simple substring matching, no word segmentation needed for this purpose.
function findTouchedHanzi(turns: ChatMessage[], learned: LearnedChar[], lang: Language): string[] {
  const text = turns.map((t) => t.content).join(' ');
  return learned.map((c) => resolveCharacterDisplay(c, lang).hanzi).filter((hanzi) => text.includes(hanzi));
}

export async function summarizeAndUpdateMemory(
  recentTurns: ChatMessage[],
  currentMemory: string,
  touchedHanzi: string[],
  currentPlan: SessionPlanDraft | null
): Promise<{ memory: string; notes: { hanzi: string; note: string }[]; plan: SessionPlanDraft | null }> {
  const transcript = recentTurns.map((t) => `${t.role}: ${t.content}`).join('\n');
  const prompt = `Here is a recent stretch of a language-tutoring conversation:\n${transcript}\n\nCurrent memory of this learner: ${currentMemory || '(nothing yet)'}\n\nWords touched in this stretch: ${touchedHanzi.join(', ') || '(none)'}\n\nCurrent session plan: ${planBlock(currentPlan)}\n\nRespond with json in exactly this shape: {"memory": "<updated, still-concise summary of topics covered, corrections made, and words the learner struggled with — fold in what's new, keep it bounded, don't just append>", "notes": [{"hanzi": "<one of the touched words>", "note": "<short read on how well the learner knows it>"}], "plan": {"focusWords": ["..."], "topics": ["..."], "goal": "<one short sentence, adjusted for how the learner is actually doing so far>"}}`;

  try {
    const raw = await chatComplete([{ role: 'user', content: prompt }], { json: true });
    const parsed = JSON.parse(raw);
    return {
      memory: typeof parsed.memory === 'string' ? parsed.memory : currentMemory,
      notes: Array.isArray(parsed.notes) ? parsed.notes : [],
      plan:
        parsed.plan && typeof parsed.plan === 'object'
          ? {
              focusWords: Array.isArray(parsed.plan.focusWords) ? parsed.plan.focusWords : [],
              topics: Array.isArray(parsed.plan.topics) ? parsed.plan.topics : [],
              goal: typeof parsed.plan.goal === 'string' ? parsed.plan.goal : '',
            }
          : currentPlan,
    };
  } catch {
    return { memory: currentMemory, notes: [], plan: currentPlan };
  }
}

export async function planSession(
  durationMin: number,
  learned: LearnedChar[],
  talkMemory: string,
  history: SessionPlan[],
  lang: Language,
  difficulty: Difficulty
): Promise<SessionPlanDraft> {
  const prompt = `Plan a ${durationMin}-minute ${LANGUAGE_NAME[lang]} speaking-practice session for a beginner learner.\nKnown words: ${knownWordsBlock(learned, lang) || '(none yet)'}\nWhat you remember about this learner: ${talkMemory || '(nothing yet)'}\nRecent past session plans, most recent last (JSON, for your own reference, never shown to the learner): ${JSON.stringify(history.slice(-3))}\n${DIFFICULTY_GUIDANCE[difficulty]}\n\nRespond with json in exactly this shape: {"focusWords": ["..."], "topics": ["..."], "goal": "<one short sentence>"}`;

  try {
    const raw = await chatComplete([{ role: 'user', content: prompt }], { json: true });
    const parsed = JSON.parse(raw);
    return {
      focusWords: Array.isArray(parsed.focusWords) ? parsed.focusWords : [],
      topics: Array.isArray(parsed.topics) ? parsed.topics : [],
      goal: typeof parsed.goal === 'string' ? parsed.goal : '',
    };
  } catch {
    return { focusWords: [], topics: [], goal: '' };
  }
}

export function useTalkSession() {
  const { state, language, addConversationWord, updateNotes, updateTalkMemory, addSessionPlan, updatePronunciation } =
    useAppState();
  const [callState, setCallState] = useState<TalkState>('idle');
  const [transcriptLog, setTranscriptLog] = useState<{ role: 'user' | 'assistant'; text: string }[]>([]);
  const [planning, setPlanning] = useState(false);
  const [currentPlan, setCurrentPlan] = useState<SessionPlanDraft | null>(null);

  const recentTurnsRef = useRef<ChatMessage[]>([]);
  // Separate from recentTurnsRef (which is trimmed to RECENT_TURNS_LIMIT for chat
  // context): accumulates every turn since the last memory summary, uncapped,
  // cleared after each summary — otherwise a summary only ever sees a fraction
  // of the exchanges it was supposed to cover.
  const turnsSinceSummaryRef = useRef<ChatMessage[]>([]);
  const callActiveRef = useRef(false);
  const busyRef = useRef(false); // true while a request is in flight or a reply is playing
  const generationRef = useRef(0); // bumped on start/end so stale async work can detect it's stale
  const languageRef = useRef(language);
  const stateRef = useRef(state);
  useEffect(() => {
    stateRef.current = state;
    languageRef.current = language;
  });

  const currentPlanRef = useRef<SessionPlanDraft | null>(null);
  const durationMinRef = useRef(0);
  const callStartedAtRef = useRef(0);
  const contextSignalsRef = useRef(''); // time/weather/schedule, fetched once per call
  const awaitingEchoRef = useRef<string[]>([]); // known words the tutor just modeled, for the pronunciation heuristic

  // Forward refs: handleTranscript needs start/stop, but those only exist once
  // useSpeechRecognition(handleTranscript) has been called below.
  const startRef = useRef<() => void>(() => {});
  const stopRef = useRef<() => void>(() => {});

  const exchangeCountRef = useRef(0);
  // onComplete receives the just-resolved (or, if there was nothing new to
  // summarize, the current) memory string — callers that need to persist
  // something derived from memory (endCall's session-plan outcome) must wait
  // for this instead of reading stateRef.current.talkMemory synchronously,
  // since updateTalkMemory above hasn't landed in state yet at that point.
  const runMemoryUpdate = useCallback(
    (onComplete?: (memory: string) => void) => {
      const turns = turnsSinceSummaryRef.current;
      if (turns.length === 0) {
        onComplete?.(stateRef.current.talkMemory);
        return;
      }
      turnsSinceSummaryRef.current = [];
      const lang = languageRef.current;
      const touched = findTouchedHanzi(turns, stateRef.current.learned, lang);
      summarizeAndUpdateMemory(turns, stateRef.current.talkMemory, touched, currentPlanRef.current).then(
        ({ memory, notes, plan }) => {
          updateTalkMemory(memory);
          for (const note of notes) {
            const entry = stateRef.current.learned.find((c) => resolveCharacterDisplay(c, lang).hanzi === note.hanzi);
            if (entry) updateNotes(entry.id, note.note);
          }
          currentPlanRef.current = plan;
          setCurrentPlan(plan);
          onComplete?.(memory);
        }
      );
    },
    [updateNotes, updateTalkMemory]
  );
  const triggerMemoryUpdateIfDue = useCallback(() => {
    exchangeCountRef.current += 1;
    if (exchangeCountRef.current >= EXCHANGE_THRESHOLD) {
      exchangeCountRef.current = 0;
      runMemoryUpdate();
    }
  }, [runMemoryUpdate]);
  const flushMemoryUpdate = useCallback(
    (onComplete?: (memory: string) => void) => {
      exchangeCountRef.current = 0;
      runMemoryUpdate(onComplete);
    },
    [runMemoryUpdate]
  );

  const speakingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clearSpeakingTimeout = useCallback(() => {
    if (speakingTimeoutRef.current) {
      clearTimeout(speakingTimeoutRef.current);
      speakingTimeoutRef.current = null;
    }
  }, []);

  const contextualStringsFor = useCallback((learned: LearnedChar[], lang: Language) => {
    const words = learned.map((c) => resolveCharacterDisplay(c, lang).hanzi).slice(-MAX_CONTEXTUAL_STRINGS);
    return [...words, GOODBYE_REPLY[lang]];
  }, []);

  const handleTranscript = useCallback(
    (transcript: string) => {
      if (!transcript.trim()) return;
      if (busyRef.current) return; // a reply is already in flight/playing — ignore overlapping input

      const lang = languageRef.current;

      if (isGoodbye(transcript, lang)) {
        callActiveRef.current = false;
        generationRef.current += 1;
        stopRef.current();
        flushMemoryUpdate();
        setCallState('idle');
        speakWithElevenLabs(GOODBYE_REPLY[lang], { rate: SPEECH_RATE });
        return;
      }

      // Pronunciation heuristic: did the learner echo back any word the tutor
      // modeled in its last reply? Local string match only, no API call —
      // ponytail: substring/whole-word match, not a real phoneme check; a
      // miss here just means "didn't say that word back," not "said it wrong."
      // Most-recent-evidence-wins, same policy as the DeepSeek-driven notes.
      for (const word of awaitingEchoRef.current) {
        const said = lang === 'zh' ? transcript.includes(word) : transcript.toLowerCase().includes(word.toLowerCase());
        const entry = stateRef.current.learned.find((c) => resolveCharacterDisplay(c, lang).hanzi === word);
        if (!entry) continue;
        updatePronunciation(
          entry.id,
          said
            ? 'Practiced in conversation: said it back correctly.'
            : "Practiced in conversation: didn't say it back when prompted — worth repeating."
        );
      }
      awaitingEchoRef.current = [];

      // Pause recognition while we think/speak — continuous mode would otherwise
      // keep listening through the reply and could pick up the TTS audio itself.
      busyRef.current = true;
      stopRef.current();
      setTranscriptLog((prev) => [...prev, { role: 'user', text: transcript }]);
      const userMessage: ChatMessage = { role: 'user', content: transcript };
      recentTurnsRef.current = [...recentTurnsRef.current, userMessage].slice(-RECENT_TURNS_LIMIT);
      turnsSinceSummaryRef.current = [...turnsSinceSummaryRef.current, userMessage];
      setCallState('thinking');

      const overtime = durationMinRef.current > 0 && Date.now() - callStartedAtRef.current > durationMinRef.current * 60_000;
      const messages: ChatMessage[] = [
        {
          role: 'system',
          content: `${systemPrompt(lang, stateRef.current.difficulty)}\n\nKnown words: ${knownWordsBlock(stateRef.current.learned, lang)}\n\nWhat you remember about this learner so far: ${stateRef.current.talkMemory || '(nothing yet)'}\n\nSession plan: ${planBlock(currentPlanRef.current)}\n\n${contextSignalsRef.current || '(no time/weather/schedule context available)'}${overtime ? '\n\nThe planned session time is up — start wrapping the conversation toward a natural close over the next turn or two.' : ''}`,
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

      // Streams the reply so each sentence starts speaking as soon as it's
      // complete, instead of waiting for the full completion before any TTS
      // synthesis begins. pendingPlaybacks + streamDone together track when
      // every enqueued sentence has actually finished playing AND no more text
      // is coming, so resumeListening fires exactly once, however many
      // sentences the reply turned out to have.
      let rest = '';
      let sawFirstSentence = false;
      let pendingPlaybacks = 0;
      let streamDone = false;
      const maybeResume = () => {
        if (streamDone && pendingPlaybacks === 0) resumeListening();
      };
      const speakSentence = (text: string) => {
        const { cleanText, newWords } = parseNewWordTags(text);
        for (const word of newWords) addConversationWord(word);
        if (!sawFirstSentence) {
          sawFirstSentence = true;
          setCallState('speaking');
        }
        pendingPlaybacks += 1;
        clearSpeakingTimeout();
        speakingTimeoutRef.current = setTimeout(resumeListening, SPEAKING_SAFETY_TIMEOUT_MS);
        enqueueElevenLabsSpeech(cleanText, {
          rate: SPEECH_RATE,
          onSettled: () => {
            pendingPlaybacks -= 1;
            maybeResume();
          },
        });
      };

      chatCompleteStream(messages, (delta) => {
        if (requestGeneration !== generationRef.current) return;
        rest += delta;
        const { sentences, rest: remainder } = extractCompleteSentences(rest);
        rest = remainder;
        for (const sentence of sentences) speakSentence(sentence);
      })
        .then((reply) => {
          if (requestGeneration !== generationRef.current) return; // call ended/restarted while this was in flight
          if (rest.trim()) speakSentence(rest);
          streamDone = true;
          if (!sawFirstSentence) {
            // Reply was empty/unspeakable — still need to resume listening.
            setCallState('speaking');
            resumeListening();
          } else {
            maybeResume();
          }
          const { cleanText } = parseNewWordTags(reply);
          setTranscriptLog((prev) => [...prev, { role: 'assistant', text: cleanText }]);
          const assistantMessage: ChatMessage = { role: 'assistant', content: reply };
          recentTurnsRef.current = [...recentTurnsRef.current, assistantMessage].slice(-RECENT_TURNS_LIMIT);
          turnsSinceSummaryRef.current = [...turnsSinceSummaryRef.current, assistantMessage];
          triggerMemoryUpdateIfDue();
          // Known words the tutor's reply just used — checked against the
          // learner's *next* transcript at the top of this function.
          awaitingEchoRef.current = stateRef.current.learned
            .map((c) => resolveCharacterDisplay(c, lang).hanzi)
            .filter((hanzi) => cleanText.includes(hanzi));
        })
        .catch(() => {
          if (requestGeneration !== generationRef.current) return;
          setCallState('speaking');
          clearSpeakingTimeout();
          speakingTimeoutRef.current = setTimeout(resumeListening, SPEAKING_SAFETY_TIMEOUT_MS);
          speakWithElevenLabs(ERROR_FALLBACK_REPLY, { rate: SPEECH_RATE, onSettled: resumeListening });
        });
    },
    [addConversationWord, clearSpeakingTimeout, flushMemoryUpdate, triggerMemoryUpdateIfDue, updatePronunciation]
  );

  const { start, stop, error, listening } = useSpeechRecognition(handleTranscript);
  useEffect(() => {
    startRef.current = () =>
      start({ lang: SPEECH_LOCALE[languageRef.current], contextualStrings: contextualStringsFor(stateRef.current.learned, languageRef.current) });
    stopRef.current = stop;
  }, [start, stop, contextualStringsFor]);

  // Errors from the recognizer. Transient ones (a pause, an iOS audio-session
  // interruption like a phone call) get an automatic retry. Anything else
  // (permission, network, config) is surfaced instead of silently looping —
  // see TRANSIENT_ERROR_CODES.
  useEffect(() => {
    if (!error) return;
    stopElevenLabsSpeech();
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

  const startCall = useCallback(
    async (durationMin: number) => {
      const lang = language;
      durationMinRef.current = durationMin;
      callStartedAtRef.current = Date.now();
      stopElevenLabsSpeech(); // clear any leftover audio from a just-ended previous call
      // Bump immediately (not after planning) so this call has its own identity
      // right away: a stale previous call's in-flight work is invalidated now,
      // and myGeneration below lets this call detect being cancelled (endCall,
      // or another startCall) while planSession is still in flight.
      generationRef.current += 1;
      const myGeneration = generationRef.current;
      contextSignalsRef.current = '';
      getContextSignals().then((signals) => {
        if (generationRef.current === myGeneration) contextSignalsRef.current = signals;
      });
      setPlanning(true);
      const plan = await planSession(durationMin, state.learned, state.talkMemory, state.sessionPlans, lang, state.difficulty);
      setPlanning(false);
      if (generationRef.current !== myGeneration) return; // ended/restarted while planning was in flight
      currentPlanRef.current = plan;
      setCurrentPlan(plan);

      callActiveRef.current = true;
      busyRef.current = false;
      exchangeCountRef.current = 0;
      recentTurnsRef.current = [];
      turnsSinceSummaryRef.current = [];
      awaitingEchoRef.current = [];
      setTranscriptLog([]);
      setCallState('listening');
      start({ lang: SPEECH_LOCALE[lang], contextualStrings: contextualStringsFor(state.learned, lang) });
    },
    [language, state.learned, state.talkMemory, state.sessionPlans, state.difficulty, start, contextualStringsFor]
  );

  const endCall = useCallback(() => {
    callActiveRef.current = false;
    busyRef.current = false;
    generationRef.current += 1; // invalidate any in-flight request's eventual reply
    clearSpeakingTimeout();
    stop();
    stopElevenLabsSpeech();
    const plan = currentPlanRef.current;
    const duration = durationMinRef.current;
    flushMemoryUpdate((memory) => {
      if (plan && duration > 0) {
        addSessionPlan({
          date: new Date().toISOString(),
          durationMin: duration,
          focusWords: plan.focusWords,
          topics: plan.topics,
          goal: plan.goal,
          outcome: memory,
        });
      }
    });
    currentPlanRef.current = null;
    setCurrentPlan(null);
    durationMinRef.current = 0;
    setCallState('idle');
  }, [stop, clearSpeakingTimeout, flushMemoryUpdate, addSessionPlan]);

  return { callState, transcriptLog, planning, currentPlan, startCall, endCall, error: error?.message ?? null };
}
