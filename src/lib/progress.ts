import { CHARACTERS, CHARACTERS_BY_ID } from '@/data/characters';

export type LearnedChar = {
  id: number;
  dateAdded: string;
  notes?: string;
  hanzi?: string;
  pinyin?: string;
  meaning?: string;
};
export type DailyCounts = { write: number; speak: number };
export type AppState = {
  learned: LearnedChar[];
  dailyCounts: Record<string, Record<string, DailyCounts>>;
  talkMemory: string;
};

export const EMPTY_STATE: AppState = { learned: [], dailyCounts: {}, talkMemory: '' };

const CONVERSATION_ID_START = 10_000_000;

// Conversation-sourced words carry their own hanzi/pinyin/meaning; static-dataset
// words look them up by id. Never throws — a corrupted/old record degrades visibly.
export function resolveCharacterDisplay(learned: LearnedChar): { hanzi: string; pinyin: string; meaning: string } {
  if (learned.hanzi !== undefined) {
    return { hanzi: learned.hanzi, pinyin: learned.pinyin ?? '', meaning: learned.meaning ?? '' };
  }
  const entry = CHARACTERS_BY_ID.get(learned.id);
  if (entry) return { hanzi: entry.hanzi, pinyin: entry.pinyin, meaning: entry.meaning };
  return { hanzi: '?', pinyin: '', meaning: '(unknown)' };
}

export function isHanziTracked(state: AppState, hanzi: string): boolean {
  return state.learned.some((c) => resolveCharacterDisplay(c).hanzi === hanzi);
}

// A word DeepSeek introduces in conversation joins the same tracked list Practice
// reads from. Deduped by hanzi; ids start well above the static dataset's range —
// unless the word is already in the static dataset, in which case it's added
// under *that* entry's id so the daily unlock (unlockTodayIfNeeded) never finds
// it "missing" and adds a second copy.
export function addConversationWord(
  state: AppState,
  word: { hanzi: string; pinyin: string; meaning: string },
  today: string = todayKey()
): AppState {
  const hanzi = word.hanzi.trim();
  if (isHanziTracked(state, hanzi)) return state;

  const staticEntry = CHARACTERS.find((c) => c.hanzi === hanzi);
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

// Replaces (not appends) the note — a current read on proficiency, not a log.
export function updateNotes(state: AppState, id: number, notes: string): AppState {
  return {
    ...state,
    learned: state.learned.map((c) => (c.id === id ? { ...c, notes } : c)),
  };
}

export function updateTalkMemory(state: AppState, memory: string): AppState {
  return { ...state, talkMemory: memory };
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

// Adds the next unseen character for today, if one hasn't already been added today.
// Only counts static-dataset unlocks here — a word Talk mode introduced today
// (identified by carrying its own hanzi) has its own pacing and must not block
// or consume Practice's daily slot.
export function unlockTodayIfNeeded(state: AppState, today: string = todayKey()): AppState {
  const alreadyAddedToday = state.learned.some((c) => c.dateAdded === today && c.hanzi === undefined);
  if (alreadyAddedToday) return state;

  const learnedIds = new Set(state.learned.map((c) => c.id));
  const next = CHARACTERS.find((c) => !learnedIds.has(c.id));
  if (!next) return state;

  return {
    ...state,
    learned: [...state.learned, { id: next.id, dateAdded: today }],
  };
}

export function getDailyCounts(state: AppState, charId: number, today: string = todayKey()): DailyCounts {
  return state.dailyCounts[today]?.[String(charId)] ?? { write: 0, speak: 0 };
}

export function incrementCount(
  state: AppState,
  charId: number,
  kind: 'write' | 'speak',
  today: string = todayKey()
): AppState {
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
export function resetToNew(state: AppState, charId: number, today: string = todayKey()): AppState {
  return {
    ...state,
    learned: state.learned.map((c) => (c.id === charId ? { ...c, dateAdded: today } : c)),
  };
}
