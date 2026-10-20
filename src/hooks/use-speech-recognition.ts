import { useCallback, useEffect, useRef, useState } from 'react';
import {
  AVAudioSessionCategory,
  AVAudioSessionCategoryOptions,
  AVAudioSessionMode,
  ExpoSpeechRecognitionErrorCode,
  ExpoSpeechRecognitionModule,
  useSpeechRecognitionEvent,
} from 'expo-speech-recognition';

export type SpeechRecognitionError = { code: ExpoSpeechRecognitionErrorCode; message: string };

export function useSpeechRecognition(onTranscript: (text: string) => void) {
  const [listening, setListening] = useState(false);
  const [error, setError] = useState<SpeechRecognitionError | null>(null);
  const onTranscriptRef = useRef(onTranscript);
  useEffect(() => {
    onTranscriptRef.current = onTranscript;
  });

  useSpeechRecognitionEvent('start', () => setListening(true));
  useSpeechRecognitionEvent('end', () => setListening(false));
  useSpeechRecognitionEvent('result', (event) => {
    if (event.isFinal) {
      onTranscriptRef.current(event.results[0]?.transcript ?? '');
    }
  });
  useSpeechRecognitionEvent('error', (event) => {
    setError({ code: event.error, message: event.message || event.error });
  });

  const start = useCallback(() => {
    setError(null);
    ExpoSpeechRecognitionModule.requestPermissionsAsync().then((result) => {
      if (!result.granted) {
        setError({ code: 'not-allowed', message: 'Microphone/speech recognition permission not granted' });
        return;
      }
      // Hold the session open for record + playback for the life of the call,
      // not just while actively recognizing — needed so the audio session
      // survives the pauses between turns (thinking/speaking) while locked.
      ExpoSpeechRecognitionModule.setCategoryIOS({
        category: AVAudioSessionCategory.playAndRecord,
        categoryOptions: [AVAudioSessionCategoryOptions.defaultToSpeaker, AVAudioSessionCategoryOptions.allowBluetooth],
        mode: AVAudioSessionMode.default,
      });
      // Prefer on-device recognition (private, no per-use network dependency) when
      // the device supports it at all; otherwise fall back to the default rather
      // than forcing a flag that could make recognition fail outright.
      const onDeviceSupported = ExpoSpeechRecognitionModule.supportsOnDeviceRecognition();
      ExpoSpeechRecognitionModule.start({
        lang: 'zh-CN',
        continuous: true,
        interimResults: true,
        requiresOnDeviceRecognition: onDeviceSupported,
      });
    });
  }, []);

  const stop = useCallback(() => {
    ExpoSpeechRecognitionModule.stop();
  }, []);

  return { listening, start, stop, error };
}
