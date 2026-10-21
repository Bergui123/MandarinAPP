import { useMemo } from 'react';
import { FlatList, Platform, Pressable, Share, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { BottomTabInset, MaxContentWidth, Spacing } from '@/constants/theme';
import { LanguageSwitcher } from '@/components/language-switcher';
import { useAppState } from '@/hooks/use-app-state';
import {
  buildProgressSummary,
  DailyCounts,
  Language,
  LearnedChar,
  daysBetween,
  resolveCharacterDisplay,
  targetReps,
  todayKey,
} from '@/lib/progress';
import { speak } from '@/lib/speech';
import { SPEECH_LOCALE } from '@/lib/language-locale';

// Scales down for multi-character words so they still fit the row.
function hanziFontSize(length: number): number {
  return length > 1 ? Math.max(24, 48 - (length - 1) * 8) : 48;
}

function CharacterRow({
  learned,
  lang,
  isNewToday,
  counts,
  onWrite,
  onSpeak,
}: {
  learned: LearnedChar;
  lang: Language;
  isNewToday: boolean;
  counts: DailyCounts;
  onWrite: () => void;
  onSpeak: () => void;
}) {
  const char = resolveCharacterDisplay(learned, lang);

  const target = targetReps(daysBetween(learned.dateAdded, todayKey()));
  const backgroundType = isNewToday ? 'backgroundSelected' : 'backgroundElement';

  return (
    <ThemedView type={backgroundType} style={styles.row}>
      <ThemedView style={styles.hanziBlock} type={backgroundType}>
        <ThemedText style={[styles.hanzi, { fontSize: hanziFontSize(char.hanzi.length) }]}>{char.hanzi}</ThemedText>
        <ThemedText type="small" themeColor="textSecondary">
          {char.pinyin}
        </ThemedText>
        <ThemedText type="small">{char.meaning}</ThemedText>
        {learned.pronunciation && (
          <ThemedText type="small" themeColor="textSecondary">
            {learned.pronunciation}
          </ThemedText>
        )}
        {learned.notes && (
          <ThemedText type="small" themeColor="textSecondary">
            {learned.notes}
          </ThemedText>
        )}
      </ThemedView>

      <ThemedView style={styles.counters} type={backgroundType}>
        <Pressable style={styles.counterButton} onPress={onWrite}>
          <ThemedText type="smallBold">✍️ Write</ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            {counts.write} / {target}
          </ThemedText>
        </Pressable>

        <Pressable
          style={styles.counterButton}
          onPress={() => {
            speak(char.hanzi, { language: SPEECH_LOCALE[lang] });
            onSpeak();
          }}>
          <ThemedText type="smallBold">🔊 Say</ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            {counts.speak} / {target}
          </ThemedText>
        </Pressable>
      </ThemedView>
    </ThemedView>
  );
}

export default function PracticeScreen() {
  const { state, language, setLanguage, ready, addWrite, addSpeak } = useAppState();

  const today = todayKey();
  const ordered = useMemo(
    () => [...state.learned].sort((a, b) => (a.dateAdded === b.dateAdded ? 0 : a.dateAdded < b.dateAdded ? 1 : -1)),
    [state.learned]
  );

  if (!ready) {
    return (
      <ThemedView style={styles.container}>
        <SafeAreaView style={styles.safeArea} />
      </ThemedView>
    );
  }

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safeArea}>
        <ThemedText type="title" style={styles.title}>
          Today
        </ThemedText>
        <ThemedView style={styles.headerRow}>
          <LanguageSwitcher language={language} onChange={setLanguage} />
          <Pressable onPress={() => Share.share({ message: buildProgressSummary(state, language) })}>
            <ThemedView type="backgroundElement" style={styles.shareButton}>
              <ThemedText type="smallBold">Share progress</ThemedText>
            </ThemedView>
          </Pressable>
        </ThemedView>
        <ThemedText type="small" themeColor="textSecondary">
          {ordered.length} character{ordered.length === 1 ? '' : 's'} learned so far
        </ThemedText>

        <FlatList
          style={styles.list}
          contentContainerStyle={styles.listContent}
          data={ordered}
          keyExtractor={(item) => String(item.id)}
          renderItem={({ item }) => (
            <CharacterRow
              learned={item}
              lang={language}
              isNewToday={item.dateAdded === today}
              counts={state.dailyCounts[today]?.[String(item.id)] ?? { write: 0, speak: 0 }}
              onWrite={() => addWrite(item.id)}
              onSpeak={() => addSpeak(item.id)}
            />
          )}
        />
      </SafeAreaView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    width: '100%',
    maxWidth: MaxContentWidth,
    paddingHorizontal: Spacing.three,
  },
  shareButton: {
    paddingVertical: Spacing.one,
    paddingHorizontal: Spacing.three,
    borderRadius: Spacing.three,
  },
  safeArea: {
    flex: 1,
    alignItems: 'center',
    width: '100%',
    ...Platform.select({ web: { paddingTop: Spacing.six } }),
  },
  title: {
    marginTop: Spacing.four,
  },
  list: {
    width: '100%',
    maxWidth: MaxContentWidth,
  },
  listContent: {
    paddingHorizontal: Spacing.three,
    paddingTop: Spacing.three,
    paddingBottom: BottomTabInset + Spacing.four,
    gap: Spacing.two,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: Spacing.three,
    padding: Spacing.three,
    gap: Spacing.three,
  },
  hanziBlock: {
    alignItems: 'flex-start',
    flex: 1,
    gap: Spacing.half,
  },
  hanzi: {
    fontSize: 48,
    lineHeight: 52,
  },
  counters: {
    flexDirection: 'row',
    gap: Spacing.two,
  },
  counterButton: {
    alignItems: 'center',
    paddingVertical: Spacing.two,
    paddingHorizontal: Spacing.two,
  },
});
