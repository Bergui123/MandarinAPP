import AsyncStorage from '@react-native-async-storage/async-storage';
import { createContext, useCallback, useContext, useEffect, useState } from 'react';

import {
  addConversationWord,
  addSessionPlan,
  AppState,
  Difficulty,
  EMPTY_STATE,
  incrementCount,
  Language,
  LanguageState,
  migrateAppState,
  resetToNew,
  SessionPlan,
  setDifficulty,
  unlockTodayIfNeeded,
  updateNotes,
  updatePronunciation,
  updateTalkMemory,
} from '@/lib/progress';

const STORAGE_KEY = '@mandarin/state';

function useAppStateValue() {
  const [full, setFull] = useState<AppState>(EMPTY_STATE);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    (async () => {
      const raw = await AsyncStorage.getItem(STORAGE_KEY);
      const loaded = migrateAppState(raw ? JSON.parse(raw) : EMPTY_STATE);
      const lang = loaded.activeLanguage;
      setFull({ ...loaded, [lang]: unlockTodayIfNeeded(loaded[lang], lang) });
      setReady(true);
    })();
  }, []);

  // Takes an updater over the active language's bucket rather than a value so
  // callers that fire more than one action in the same tick each build on the
  // true latest state, not a stale closure from render time.
  const persist = useCallback((updater: (prev: LanguageState) => LanguageState) => {
    setFull((prev) => {
      const next = { ...prev, [prev.activeLanguage]: updater(prev[prev.activeLanguage]) };
      AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(next)).catch((err) =>
        console.warn('Failed to save app state', err)
      );
      return next;
    });
  }, []);

  const setLanguage = useCallback((lang: Language) => {
    setFull((prev) => {
      const next = { ...prev, activeLanguage: lang, [lang]: unlockTodayIfNeeded(prev[lang], lang) };
      AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(next)).catch((err) =>
        console.warn('Failed to save app state', err)
      );
      return next;
    });
  }, []);

  const addWrite = useCallback((charId: number) => persist((prev) => incrementCount(prev, charId, 'write')), [persist]);
  const addSpeak = useCallback((charId: number) => persist((prev) => incrementCount(prev, charId, 'speak')), [persist]);
  const markMissed = useCallback((charId: number) => persist((prev) => resetToNew(prev, charId)), [persist]);

  const addConversationWordAction = useCallback(
    (word: { hanzi: string; pinyin: string; meaning: string }) =>
      persist((prev) => addConversationWord(prev, word, full.activeLanguage)),
    [persist, full.activeLanguage]
  );
  const updateNotesAction = useCallback(
    (id: number, notes: string) => persist((prev) => updateNotes(prev, id, notes)),
    [persist]
  );
  const updateTalkMemoryAction = useCallback(
    (memory: string) => persist((prev) => updateTalkMemory(prev, memory)),
    [persist]
  );
  const addSessionPlanAction = useCallback(
    (plan: SessionPlan) => persist((prev) => addSessionPlan(prev, plan)),
    [persist]
  );
  const setDifficultyAction = useCallback(
    (difficulty: Difficulty) => persist((prev) => setDifficulty(prev, difficulty)),
    [persist]
  );
  const updatePronunciationAction = useCallback(
    (id: number, pronunciation: string) => persist((prev) => updatePronunciation(prev, id, pronunciation)),
    [persist]
  );

  return {
    state: full[full.activeLanguage],
    language: full.activeLanguage,
    setLanguage,
    ready,
    addWrite,
    addSpeak,
    markMissed,
    addConversationWord: addConversationWordAction,
    updateNotes: updateNotesAction,
    updateTalkMemory: updateTalkMemoryAction,
    addSessionPlan: addSessionPlanAction,
    setDifficulty: setDifficultyAction,
    updatePronunciation: updatePronunciationAction,
  };
}

type AppStateApi = ReturnType<typeof useAppStateValue>;

const AppStateContext = createContext<AppStateApi | null>(null);

// One instance of useAppStateValue, shared by every screen via context — without
// this, Practice/Quiz/Talk each held an independent AsyncStorage-backed copy and
// could silently clobber each other's saves (whichever screen saved last won).
export function AppStateProvider({ children }: { children: React.ReactNode }) {
  const value = useAppStateValue();
  return <AppStateContext.Provider value={value}>{children}</AppStateContext.Provider>;
}

export function useAppState(): AppStateApi {
  const ctx = useContext(AppStateContext);
  if (!ctx) throw new Error('useAppState must be used within an AppStateProvider');
  return ctx;
}
