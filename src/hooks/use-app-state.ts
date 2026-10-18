import AsyncStorage from '@react-native-async-storage/async-storage';
import { useCallback, useEffect, useState } from 'react';

import { AppState, EMPTY_STATE, incrementCount, resetToNew, unlockTodayIfNeeded } from '@/lib/progress';

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

  const persist = useCallback((next: AppState) => {
    setState(next);
    AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  }, []);

  const addWrite = useCallback(
    (charId: number) => persist(incrementCount(state, charId, 'write')),
    [state, persist]
  );
  const addSpeak = useCallback(
    (charId: number) => persist(incrementCount(state, charId, 'speak')),
    [state, persist]
  );
  const markMissed = useCallback((charId: number) => persist(resetToNew(state, charId)), [state, persist]);

  return { state, ready, addWrite, addSpeak, markMissed };
}
