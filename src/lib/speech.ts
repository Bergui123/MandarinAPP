import * as Speech from 'expo-speech';

export function speak(text: string, options?: { rate?: number; onDone?: () => void }): void {
  Speech.stop();
  Speech.speak(text, { language: 'zh-CN', rate: options?.rate ?? 1.0, onDone: options?.onDone });
}
