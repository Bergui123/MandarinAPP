import { useCallback, useEffect, useRef, useState } from 'react';
import { ExpoSpeechRecognitionModule, useSpeechRecognitionEvent } from 'expo-speech-recognition';

export function useSpeechRecognition(onTranscript: (text: string) => void) {
  const [listening, setListening] = useState(false);
  const [error, setError] = useState<string | null>(null);
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
    setError(event.message || event.error);
  });

  const start = useCallback(() => {
    setError(null);
    ExpoSpeechRecognitionModule.requestPermissionsAsync().then((result) => {
      if (!result.granted) {
        setError('Microphone/speech recognition permission not granted');
        return;
      }
      ExpoSpeechRecognitionModule.start({
        lang: 'zh-CN',
        continuous: true,
        interimResults: true,
      });
    });
  }, []);

  const stop = useCallback(() => {
    ExpoSpeechRecognitionModule.stop();
  }, []);

  return { listening, start, stop, error };
}
