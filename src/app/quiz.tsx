import { useState } from 'react';
import { Platform, Pressable, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { BottomTabInset, MaxContentWidth, Spacing } from '@/constants/theme';
import { useAppState } from '@/hooks/use-app-state';
import { resolveCharacterDisplay } from '@/lib/progress';

// Scales down for multi-character words so they still fit the card.
function hanziFontSize(length: number): number {
  return length > 1 ? Math.max(48, 96 - (length - 1) * 16) : 96;
}

function shuffled(ids: number[]): number[] {
  const copy = [...ids];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

export default function QuizScreen() {
  const { state, ready, markMissed } = useAppState();
  const [sessionIds, setSessionIds] = useState<number[] | null>(null);
  const [index, setIndex] = useState(0);
  const [flipped, setFlipped] = useState(false);

  // One-time init once the persisted state has loaded (not an effect: see
  // https://react.dev/learn/you-might-not-need-an-effect#adjusting-state-based-on-a-prop-or-other-state-change).
  if (ready && sessionIds === null) {
    setSessionIds(shuffled(state.learned.map((c) => c.id)));
  }

  function startNewSession() {
    setSessionIds(shuffled(state.learned.map((c) => c.id)));
    setIndex(0);
    setFlipped(false);
  }

  function next() {
    setIndex((i) => i + 1);
    setFlipped(false);
  }

  if (!ready || sessionIds === null) {
    return (
      <ThemedView style={styles.container}>
        <SafeAreaView style={styles.safeArea} />
      </ThemedView>
    );
  }

  if (sessionIds.length === 0) {
    return (
      <ThemedView style={styles.container}>
        <SafeAreaView style={styles.safeArea}>
          <ThemedText type="subtitle">Quiz</ThemedText>
          <ThemedText themeColor="textSecondary">
            Learn your first character on the Practice tab, then come back to quiz yourself.
          </ThemedText>
        </SafeAreaView>
      </ThemedView>
    );
  }

  if (index >= sessionIds.length) {
    return (
      <ThemedView style={styles.container}>
        <SafeAreaView style={styles.safeArea}>
          <ThemedText type="subtitle">Quiz complete</ThemedText>
          <ThemedText themeColor="textSecondary">
            You went through all {sessionIds.length} character{sessionIds.length === 1 ? '' : 's'}.
          </ThemedText>
          <Pressable onPress={startNewSession}>
            <ThemedView type="backgroundElement" style={styles.restartButton}>
              <ThemedText type="smallBold">Quiz again</ThemedText>
            </ThemedView>
          </Pressable>
        </SafeAreaView>
      </ThemedView>
    );
  }

  const learnedEntry = state.learned.find((c) => c.id === sessionIds[index])!;
  const char = resolveCharacterDisplay(learnedEntry);

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safeArea}>
        <ThemedText type="small" themeColor="textSecondary">
          Card {index + 1} of {sessionIds.length}
        </ThemedText>

        <Pressable style={styles.cardPressable} onPress={() => setFlipped((f) => !f)}>
          <ThemedView type="backgroundElement" style={styles.card}>
            <ThemedText style={[styles.hanzi, { fontSize: hanziFontSize(char.hanzi.length) }]}>
              {char.hanzi}
            </ThemedText>
            <ThemedText themeColor="textSecondary">{char.pinyin}</ThemedText>
            {flipped ? (
              <ThemedText type="subtitle" style={styles.meaning}>
                {char.meaning}
              </ThemedText>
            ) : (
              <ThemedText type="small" themeColor="textSecondary">
                Tap to reveal
              </ThemedText>
            )}
          </ThemedView>
        </Pressable>

        {flipped && (
          <ThemedView style={styles.answerRow}>
            <Pressable
              style={styles.answerButton}
              onPress={() => {
                markMissed(learnedEntry.id);
                next();
              }}>
              <ThemedView type="backgroundElement" style={styles.answerButtonInner}>
                <ThemedText type="smallBold">Missed it</ThemedText>
              </ThemedView>
            </Pressable>
            <Pressable style={styles.answerButton} onPress={next}>
              <ThemedView type="backgroundSelected" style={styles.answerButtonInner}>
                <ThemedText type="smallBold">Got it</ThemedText>
              </ThemedView>
            </Pressable>
          </ThemedView>
        )}
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
    paddingTop: Spacing.four,
    paddingBottom: BottomTabInset + Spacing.four,
    gap: Spacing.four,
    ...Platform.select({ web: { paddingTop: Spacing.six + Spacing.four } }),
  },
  cardPressable: {
    width: '100%',
  },
  card: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.three,
    borderRadius: Spacing.four,
    paddingVertical: Spacing.six,
  },
  hanzi: {
    fontSize: 96,
    lineHeight: 100,
  },
  meaning: {
    textAlign: 'center',
  },
  answerRow: {
    flexDirection: 'row',
    gap: Spacing.three,
    width: '100%',
  },
  answerButton: {
    flex: 1,
  },
  answerButtonInner: {
    alignItems: 'center',
    paddingVertical: Spacing.three,
    borderRadius: Spacing.three,
  },
  restartButton: {
    paddingVertical: Spacing.two,
    paddingHorizontal: Spacing.four,
    borderRadius: Spacing.three,
  },
});
