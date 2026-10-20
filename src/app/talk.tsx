import { Platform, Pressable, ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { MaxContentWidth, Spacing } from '@/constants/theme';
import { useTalkSession } from '@/hooks/use-talk-session';

const STATE_LABEL: Record<string, string> = {
  idle: 'Start',
  listening: 'Listening…',
  thinking: 'Thinking…',
  speaking: 'Speaking…',
};

export default function TalkScreen() {
  const { callState, transcriptLog, startCall, endCall } = useTalkSession();
  const active = callState !== 'idle';

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safeArea}>
        <ThemedText type="title" style={styles.title}>
          Talk
        </ThemedText>

        <Pressable onPress={active ? endCall : startCall}>
          <ThemedView type={active ? 'backgroundSelected' : 'backgroundElement'} style={styles.button}>
            <ThemedText type="smallBold">{active ? `${STATE_LABEL[callState]} (tap to end)` : 'Start'}</ThemedText>
          </ThemedView>
        </Pressable>

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
