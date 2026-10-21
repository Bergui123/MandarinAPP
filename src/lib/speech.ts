import * as Speech from 'expo-speech';

export function speak(
  text: string,
  options?: { language?: string; rate?: number; onDone?: () => void; onSettled?: () => void }
): void {
  Speech.stop();
  // onSettled fires whichever way playback ends (finished, stopped, or errored) —
  // callers that just need to know "speaking is over, safe to resume listening"
  // want this rather than only the happy-path onDone.
  Speech.speak(text, {
    language: options?.language ?? 'zh-CN',
    rate: options?.rate ?? 1.0,
    onDone: () => {
      options?.onDone?.();
      options?.onSettled?.();
    },
    onStopped: options?.onSettled,
    onError: options?.onSettled,
  });
}
