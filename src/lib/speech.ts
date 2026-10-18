import * as Speech from 'expo-speech';

export function speak(text: string, options?: { rate?: number }): void {
  Speech.stop();
  Speech.speak(text, { language: 'zh-CN', rate: options?.rate ?? 1.0 });
}
