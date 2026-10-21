import { AudioPlayer, createAudioPlayer } from 'expo-audio';
import { File, Paths } from 'expo-file-system';

import { getElevenLabsApiKey } from '@/lib/env';

// "Roger" — a premade voice available on ElevenLabs' free tier. Swap this if
// the account upgrades to a plan that unlocks native-Mandarin-accented voices
// (several were found in the shared library, e.g. "Ladaisy" / "Serena").
const VOICE_ID = 'CwhRBWXzGAHq8TQ4Fs17';
const MODEL_ID = 'eleven_flash_v2_5'; // low-latency, suited to a live conversation

// Tracks whatever's currently playing so stopElevenLabsSpeech() can interrupt
// it — mirrors expo-speech's Speech.stop() being a single global "stop now".
let current: { player: AudioPlayer; file: File } | null = null;

function cleanup() {
  if (!current) return;
  const { player, file } = current;
  current = null;
  player.release();
  file.delete();
}

export function stopElevenLabsSpeech(): void {
  cleanup();
}

export function speakWithElevenLabs(text: string, options?: { rate?: number; onSettled?: () => void }): void {
  cleanup(); // only one reply plays at a time

  (async () => {
    let file: File | null = null;
    try {
      const response = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${VOICE_ID}?output_format=mp3_44100_128`, {
        method: 'POST',
        headers: {
          'xi-api-key': getElevenLabsApiKey(),
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ text, model_id: MODEL_ID }),
      });
      if (!response.ok) {
        const body = await response.text();
        throw new Error(`ElevenLabs request failed (${response.status}): ${body}`);
      }

      const bytes = new Uint8Array(await response.arrayBuffer());
      file = new File(Paths.cache, `talk-reply-${Date.now()}.mp3`);
      file.create();
      file.write(bytes);

      const player = createAudioPlayer({ uri: file.uri });
      player.setPlaybackRate(options?.rate ?? 1.0, 'high');
      current = { player, file };

      const subscription = player.addListener('playbackStatusUpdate', (status) => {
        if (status.didJustFinish || status.error) {
          subscription.remove();
          cleanup();
          options?.onSettled?.();
        }
      });
      player.play();
    } catch (err) {
      console.warn('ElevenLabs TTS failed', err);
      file?.delete();
      options?.onSettled?.();
    }
  })();
}
