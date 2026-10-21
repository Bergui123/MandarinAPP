import { useEffect } from 'react';
import { DarkTheme, DefaultTheme, ThemeProvider } from 'expo-router';
import { useColorScheme } from 'react-native';

import AppTabs from '@/components/app-tabs';
import { AppStateProvider } from '@/hooks/use-app-state';
import * as QuickActions from 'expo-quick-actions';
import { RouterAction, useQuickActionRouting } from 'expo-quick-actions/router';

const QUICK_ACTION_DURATION_MIN = 10;

export default function TabLayout() {
  const colorScheme = useColorScheme();
  // Links a quick action's `params.href` straight to that route when the app
  // is opened from the home-screen shortcut.
  useQuickActionRouting();

  useEffect(() => {
    QuickActions.setItems<RouterAction>([
      { id: 'talk-zh', title: 'Start Mandarin', icon: 'compose', params: { href: `/talk?autoStart=zh&duration=${QUICK_ACTION_DURATION_MIN}` } },
      { id: 'talk-fr', title: 'Start French', icon: 'compose', params: { href: `/talk?autoStart=fr&duration=${QUICK_ACTION_DURATION_MIN}` } },
    ]);
  }, []);

  return (
    <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
      <AppStateProvider>
        <AppTabs />
      </AppStateProvider>
    </ThemeProvider>
  );
}
