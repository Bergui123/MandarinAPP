import { useEffect, useRef } from 'react';
import { Platform, Pressable, ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams } from 'expo-router';

import { LanguageSwitcher } from '@/components/language-switcher';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { MaxContentWidth, Spacing } from '@/constants/theme';
import { useAppState } from '@/hooks/use-app-state';
import { useTalkSession } from '@/hooks/use-talk-session';
import { Difficulty } from '@/lib/progress';

const STATE_LABEL: Record<string, string> = {
  idle: 'Start',
  listening: 'Listening…',
  thinking: 'Thinking…',
  speaking: 'Speaking…',
};

const DURATION_OPTIONS_MIN = [5, 10, 15, 20];
const DIFFICULTY_OPTIONS: { value: Difficulty; label: string }[] = [
  { value: 'review', label: 'Review' },
  { value: 'balanced', label: 'Balanced' },
  { value: 'challenge', label: 'Challenge' },
];

export default function TalkScreen() {
  const { state, language, setLanguage, setDifficulty } = useAppState();
  const { callState, transcriptLog, planning, currentPlan, startCall, endCall, error } = useTalkSession();
  const active = callState !== 'idle' || planning;

  // Launched from a home-screen Quick Action (/talk?autoStart=fr&duration=10):
  // switches language if needed, then starts the call once it's idle and the
  // language switch has actually landed — fires at most once per mount.
  const params = useLocalSearchParams<{ autoStart?: string; duration?: string }>();
  const autoStartConsumedRef = useRef(false);
  useEffect(() => {
    if (autoStartConsumedRef.current) return;
    if (params.autoStart !== 'zh' && params.autoStart !== 'fr') return;
    if (language !== params.autoStart) {
      setLanguage(params.autoStart);
      return;
    }
    if (callState !== 'idle' || planning) return;
    autoStartConsumedRef.current = true;
    startCall(Number(params.duration) || 10);
  }, [params.autoStart, params.duration, language, callState, planning, setLanguage, startCall]);

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safeArea}>
        <ThemedText type="title" style={styles.title}>
          Talk
        </ThemedText>

        {!active && (
          <>
            <LanguageSwitcher language={language} onChange={setLanguage} />
            <ThemedView style={styles.difficultyRow}>
              {DIFFICULTY_OPTIONS.map((opt) => (
                <Pressable key={opt.value} onPress={() => setDifficulty(opt.value)}>
                  <ThemedView
                    type={state.difficulty === opt.value ? 'backgroundSelected' : 'backgroundElement'}
                    style={styles.difficultyPill}>
                    <ThemedText type="small">{opt.label}</ThemedText>
                  </ThemedView>
                </Pressable>
              ))}
            </ThemedView>
          </>
        )}

        {error && (
          <ThemedText type="small" themeColor="textSecondary">
            {error}
          </ThemedText>
        )}

        {active ? (
          <Pressable onPress={endCall}>
            <ThemedView type="backgroundSelected" style={styles.button}>
              <ThemedText type="smallBold">
                {planning ? 'Planning…' : `${STATE_LABEL[callState]} (tap to end)`}
              </ThemedText>
            </ThemedView>
          </Pressable>
        ) : (
          <ThemedView style={styles.durationRow}>
            {DURATION_OPTIONS_MIN.map((min) => (
              <Pressable key={min} onPress={() => startCall(min)}>
                <ThemedView type="backgroundElement" style={styles.durationButton}>
                  <ThemedText type="smallBold">{min} min</ThemedText>
                </ThemedView>
              </Pressable>
            ))}
          </ThemedView>
        )}

        {currentPlan && currentPlan.goal && (
          <ThemedText type="small" themeColor="textSecondary" style={styles.goal}>
            Today&apos;s goal: {currentPlan.goal}
          </ThemedText>
        )}

        <ScrollView style={styles.log} contentContainerStyle={styles.logContent}>
          {[...transcriptLog].reverse().map((entry, i) => (
            <ThemedText key={i} type={entry.role === 'user' ? 'default' : 'smallBold'} style={styles.logEntry}>
              {entry.role === 'user' ? 'You: ' : 'Tutor: '}
              {entry.text}
            </ThemedText>
          ))}
        </ScrollView>
      </SafeAreaView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  safeArea: {
    flex: 1,
    alignItems: 'center',
    width: '100%',
    maxWidth: MaxContentWidth,
    paddingHorizontal: Spacing.four,
    gap: Spacing.three,
    ...Platform.select({ web: { paddingTop: Spacing.six + Spacing.four } }),
  },
  title: {
    marginTop: Spacing.four,
  },
  button: {
    paddingVertical: Spacing.three,
    paddingHorizontal: Spacing.six,
    borderRadius: Spacing.three,
  },
  durationRow: {
    flexDirection: 'row',
    gap: Spacing.two,
  },
  durationButton: {
    paddingVertical: Spacing.three,
    paddingHorizontal: Spacing.four,
    borderRadius: Spacing.three,
  },
  difficultyRow: {
    flexDirection: 'row',
    gap: Spacing.two,
  },
  difficultyPill: {
    paddingVertical: Spacing.one,
    paddingHorizontal: Spacing.three,
    borderRadius: Spacing.three,
  },
  goal: {
    textAlign: 'center',
  },
  log: {
    width: '100%',
  },
  logContent: {
    gap: Spacing.two,
    paddingBottom: Spacing.four,
  },
  logEntry: {
    paddingVertical: Spacing.one,
  },
});
