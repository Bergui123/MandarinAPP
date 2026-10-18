import AsyncStorage from '@react-native-async-storage/async-storage';
import { useCallback, useEffect, useState } from 'react';

import {
  addConversationWord,
  AppState,
  EMPTY_STATE,
  incrementCount,
  resetToNew,
  unlockTodayIfNeeded,
  updateNotes,
  updateTalkMemory,
} from '@/lib/progress';

const STORAGE_KEY = '@mandarin/state';

export function useAppState() {
  const [state, setState] = useState<AppState>(EMPTY_STATE);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    (async () => {
      const raw = await AsyncStorage.getItem(STORAGE_KEY);
      const loaded: AppState = raw ? JSON.parse(raw) : EMPTY_STATE;
      setState(unlockTodayIfNeeded(loaded));
      setReady(true);
    })();
  }, []);

  // Takes an updater rather than a value so callers that fire more than one
  // action in the same tick (e.g. several addConversationWord calls followed
  // by updateTalkMemory) each build on the true latest state, not a stale
  // closure from render time.
  const persist = useCallback((updater: (prev: AppState) => AppState) => {
    setState((prev) => {
      const next = updater(prev);
      AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      return next;
    });
  }, []);

  const addWrite = useCallback((charId: number) => persist((prev) => incrementCount(prev, charId, 'write')), [persist]);
  const addSpeak = useCallback((charId: number) => persist((prev) => incrementCount(prev, charId, 'speak')), [persist]);
  const markMissed = useCallback((charId: number) => persist((prev) => resetToNew(prev, charId)), [persist]);

  const addConversationWordAction = useCallback(
    (word: { hanzi: string; pinyin: string; meaning: string }) => persist((prev) => addConversationWord(prev, word)),
    [persist]
  );
  const updateNotesAction = useCallback(
    (id: number, notes: string) => persist((prev) => updateNotes(prev, id, notes)),
    [persist]
  );
  const updateTalkMemoryAction = useCallback(
    (memory: string) => persist((prev) => updateTalkMemory(prev, memory)),
    [persist]
  );

  return {
    state,
    ready,
    addWrite,
    addSpeak,
    markMissed,
    addConversationWord: addConversationWordAction,
    updateNotes: updateNotesAction,
    updateTalkMemory: updateTalkMemoryAction,
  };
}
