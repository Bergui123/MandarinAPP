import { useState } from 'react';
import { Platform, Pressable, ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { MaxContentWidth, Spacing } from '@/constants/theme';
import { useSpeechRecognition } from '@/hooks/use-speech-recognition';

export default function TalkScreen() {
  const [log, setLog] = useState<string[]>([]);
  const { listening, start, stop, error } = useSpeechRecognition((text) => {
    setLog((prev) => [text, ...prev]);
  });

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safeArea}>
        <ThemedText type="title" style={styles.title}>
          Talk
        </ThemedText>
        <ThemedText type="small" themeColor="textSecondary">
          {listening ? 'Listening…' : 'Not listening'}
        </ThemedText>
        {error && (
          <ThemedText type="small" themeColor="textSecondary">
            Error: {error}
          </ThemedText>
        )}

        <Pressable onPress={listening ? stop : start}>
          <ThemedView type={listening ? 'backgroundSelected' : 'backgroundElement'} style={styles.button}>
            <ThemedText type="smallBold">{listening ? 'Stop' : 'Start'}</ThemedText>
          </ThemedView>
        </Pressable>

        <ScrollView style={styles.log} contentContainerStyle={styles.logContent}>
          {log.map((entry, i) => (
            <ThemedText key={i} style={styles.logEntry}>
              {entry}
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
