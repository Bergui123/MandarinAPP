import { Language } from '@/lib/progress';

// BCP-47 locale for STT (expo-speech-recognition) and TTS (expo-speech) — the
// one place language picks a concrete locale string, so it's never duplicated.
export const SPEECH_LOCALE: Record<Language, string> = {
  zh: 'zh-CN',
  fr: 'fr-FR',
};
