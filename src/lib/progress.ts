import { CHARACTERS, CHARACTERS_BY_ID } from '@/data/characters';
import { FRENCH_WORDS, FRENCH_WORDS_BY_ID } from '@/data/french-words';

export type Language = 'zh' | 'fr';

export type LearnedChar = {
  id: number;
  dateAdded: string;
  notes?: string;
  // Separate from `notes` (DeepSeek's periodic qualitative read): a local,
  // zero-API-call heuristic signal from Talk mode — did the learner echo back
  // a word the tutor just modeled? Its own field so the two don't overwrite
  // each other, since both replace rather than append.
  pronunciation?: string;
  hanzi?: string;
  pinyin?: string;
  meaning?: string;
};
export type DailyCounts = { write: number; speak: number };

export type SessionPlan = {
  date: string;
  durationMin: number;
  focusWords: string[];
  topics: string[];
  goal: string;
  outcome?: string;
};

export type Difficulty = 'review' | 'balanced' | 'challenge';

export type LanguageState = {
  learned: LearnedChar[];
  dailyCounts: Record<string, Record<string, DailyCounts>>;
  talkMemory: string;
  sessionPlans: SessionPlan[];
  difficulty: Difficulty;
};

export type AppState = {
  activeLanguage: Language;
  zh: LanguageState;
  fr: LanguageState;
};

export const EMPTY_LANGUAGE_STATE: LanguageState = {
  learned: [],
  dailyCounts: {},
  talkMemory: '',
  sessionPlans: [],
  difficulty: 'balanced',
};
export const EMPTY_STATE: AppState = { activeLanguage: 'zh', zh: EMPTY_LANGUAGE_STATE, fr: EMPTY_LANGUAGE_STATE };

const VOCAB_BY_LANG: Record<Language, typeof CHARACTERS> = { zh: CHARACTERS, fr: FRENCH_WORDS };
const VOCAB_BY_ID_BY_LANG: Record<Language, typeof CHARACTERS_BY_ID> = { zh: CHARACTERS_BY_ID, fr: FRENCH_WORDS_BY_ID };

const SESSION_PLAN_HISTORY_LIMIT = 20;

// Fills in fields added after a save was written (sessionPlans, difficulty)
// so older saves on disk don't crash on the new shape.
function withDefaults(state: Partial<LanguageState> | undefined): LanguageState {
  return { ...EMPTY_LANGUAGE_STATE, ...state };
}

// Old saves were a flat LanguageState (no activeLanguage/zh/fr wrapper) — adopt
// that as the zh bucket so existing Mandarin progress isn't lost.
export function migrateAppState(raw: unknown): AppState {
  if (raw && typeof raw === 'object' && 'learned' in raw) {
    return { activeLanguage: 'zh', zh: withDefaults(raw as LanguageState), fr: EMPTY_LANGUAGE_STATE };
  }
  if (raw && typeof raw === 'object' && 'activeLanguage' in raw) {
    const old = raw as AppState;
    return { activeLanguage: old.activeLanguage, zh: withDefaults(old.zh), fr: withDefaults(old.fr) };
  }
  return EMPTY_STATE;
}

export function setDifficulty(state: LanguageState, difficulty: Difficulty): LanguageState {
  return { ...state, difficulty };
}

// Conversation-sourced words carry their own hanzi/pinyin/meaning; static-dataset
// words look them up by id. Never throws — a corrupted/old record degrades visibly.
export function resolveCharacterDisplay(
  learned: LearnedChar,
  lang: Language = 'zh'
): { hanzi: string; pinyin: string; meaning: string } {
  if (learned.hanzi !== undefined) {
    return { hanzi: learned.hanzi, pinyin: learned.pinyin ?? '', meaning: learned.meaning ?? '' };
  }
  const entry = VOCAB_BY_ID_BY_LANG[lang].get(learned.id);
  if (entry) return { hanzi: entry.hanzi, pinyin: entry.pinyin, meaning: entry.meaning };
  return { hanzi: '?', pinyin: '', meaning: '(unknown)' };
}

export function isHanziTracked(state: LanguageState, hanzi: string, lang: Language = 'zh'): boolean {
  return state.learned.some((c) => resolveCharacterDisplay(c, lang).hanzi === hanzi);
}

// A word DeepSeek introduces in conversation joins the same tracked list Practice
// reads from. Deduped by hanzi; ids start well above the static dataset's range —
// unless the word is already in the static dataset, in which case it's added
// under *that* entry's id so the daily unlock (unlockTodayIfNeeded) never finds
// it "missing" and adds a second copy.
export function addConversationWord(
  state: LanguageState,
  word: { hanzi: string; pinyin: string; meaning: string },
  lang: Language = 'zh',
  today: string = todayKey()
): LanguageState {
  const hanzi = word.hanzi.trim();
  if (isHanziTracked(state, hanzi, lang)) return state;

  const staticEntry = VOCAB_BY_LANG[lang].find((c) => c.hanzi === hanzi);
  if (staticEntry) {
    return { ...state, learned: [...state.learned, { id: staticEntry.id, dateAdded: today }] };
  }

  const usedIds = new Set(state.learned.map((c) => c.id));
  let id = CONVERSATION_ID_START;
  while (usedIds.has(id)) id++;

  return {
    ...state,
    learned: [...state.learned, { id, dateAdded: today, hanzi, pinyin: word.pinyin, meaning: word.meaning }],
  };
}

const CONVERSATION_ID_START = 10_000_000;

// Replaces (not appends) the note — a current read on proficiency, not a log.
export function updateNotes(state: LanguageState, id: number, notes: string): LanguageState {
  return {
    ...state,
    learned: state.learned.map((c) => (c.id === id ? { ...c, notes } : c)),
  };
}

export function updateTalkMemory(state: LanguageState, memory: string): LanguageState {
  return { ...state, talkMemory: memory };
}

// Replaces (not appends) — most recent evidence wins, same policy as updateNotes.
export function updatePronunciation(state: LanguageState, id: number, pronunciation: string): LanguageState {
  return {
    ...state,
    learned: state.learned.map((c) => (c.id === id ? { ...c, pronunciation } : c)),
  };
}

const LANGUAGE_LABEL: Record<Language, string> = { zh: 'Mandarin', fr: 'French' };

// Plain-text summary for sharing (Share.share) — not meant to be structured
// data, just a readable snapshot of where this learner's at.
export function buildProgressSummary(state: LanguageState, lang: Language): string {
  const lines = [`${LANGUAGE_LABEL[lang]} progress — ${state.learned.length} word${state.learned.length === 1 ? '' : 's'} learned`];

  const recentPlans = state.sessionPlans.slice(-3).reverse();
  if (recentPlans.length > 0) {
    lines.push('', 'Recent sessions:');
    for (const plan of recentPlans) {
      const date = new Date(plan.date).toLocaleDateString();
      lines.push(`- ${date} (${plan.durationMin} min): ${plan.goal || 'no goal set'}`);
    }
  }

  if (state.talkMemory) {
    lines.push('', `Tutor's notes: ${state.talkMemory}`);
  }

  return lines.join('\n');
}

// Most-recent-last; capped so history can't grow unbounded over months of use.
export function addSessionPlan(state: LanguageState, plan: SessionPlan): LanguageState {
  return { ...state, sessionPlans: [...state.sessionPlans, plan].slice(-SESSION_PLAN_HISTORY_LIMIT) };
}

export function todayKey(date: Date = new Date()): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function daysBetween(dateAdded: string, today: string): number {
  const a = new Date(dateAdded + 'T00:00:00');
  const b = new Date(today + 'T00:00:00');
  const diff = Math.round((b.getTime() - a.getTime()) / (1000 * 60 * 60 * 24));
  return Math.max(0, diff);
}

const MIN_REPS = 5;

// New character starts at 100 reps/day and roughly halves each day known, down to a floor.
export function targetReps(daysKnown: number): number {
  return Math.max(MIN_REPS, Math.round(100 / Math.pow(2, daysKnown)));
}

// Adds the next unseen word for today, if one hasn't already been added today.
// Only counts static-dataset unlocks here — a word Talk mode introduced today
// (identified by carrying its own hanzi) has its own pacing and must not block
// or consume Practice's daily slot.
export function unlockTodayIfNeeded(state: LanguageState, lang: Language = 'zh', today: string = todayKey()): LanguageState {
  const alreadyAddedToday = state.learned.some((c) => c.dateAdded === today && c.hanzi === undefined);
  if (alreadyAddedToday) return state;

  const learnedIds = new Set(state.learned.map((c) => c.id));
  const next = VOCAB_BY_LANG[lang].find((c) => !learnedIds.has(c.id));
  if (!next) return state;

  return {
    ...state,
    learned: [...state.learned, { id: next.id, dateAdded: today }],
  };
}

export function getDailyCounts(state: LanguageState, charId: number, today: string = todayKey()): DailyCounts {
  return state.dailyCounts[today]?.[String(charId)] ?? { write: 0, speak: 0 };
}

export function incrementCount(
  state: LanguageState,
  charId: number,
  kind: 'write' | 'speak',
  today: string = todayKey()
): LanguageState {
  const current = getDailyCounts(state, charId, today);
  const updated = { ...current, [kind]: current[kind] + 1 };
  return {
    ...state,
    dailyCounts: {
      ...state.dailyCounts,
      [today]: { ...state.dailyCounts[today], [String(charId)]: updated },
    },
  };
}

// A wrong quiz answer resets the character back to "new" (100 reps again).
export function resetToNew(state: LanguageState, charId: number, today: string = todayKey()): LanguageState {
  return {
    ...state,
    learned: state.learned.map((c) => (c.id === charId ? { ...c, dateAdded: today } : c)),
  };
}
