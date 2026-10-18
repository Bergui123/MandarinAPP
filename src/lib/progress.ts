import { CHARACTERS } from '@/data/characters';

export type LearnedChar = { id: number; dateAdded: string };
export type DailyCounts = { write: number; speak: number };
export type AppState = {
  learned: LearnedChar[];
  dailyCounts: Record<string, Record<string, DailyCounts>>;
};

export const EMPTY_STATE: AppState = { learned: [], dailyCounts: {} };

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
export function unlockTodayIfNeeded(state: AppState, today: string = todayKey()): AppState {
  const alreadyAddedToday = state.learned.some((c) => c.dateAdded === today);
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
