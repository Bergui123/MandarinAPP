import { AudioPlayer, createAudioPlayer } from 'expo-audio';
import { File, Paths } from 'expo-file-system';

import { getElevenLabsApiKey } from '@/lib/env';

// "Roger" — a premade voice available on ElevenLabs' free tier. Swap this if
// the account upgrades to a plan that unlocks native-Mandarin-accented voices
// (several were found in the shared library, e.g. "Ladaisy" / "Serena").
// eleven_flash_v2_5 and this voice are both multilingual — no per-language swap needed.
const VOICE_ID = 'CwhRBWXzGAHq8TQ4Fs17';
const MODEL_ID = 'eleven_flash_v2_5'; // low-latency, suited to a live conversation

type SpeechOptions = { rate?: number; onSettled?: () => void };
type QueueItem = { text: string; options?: SpeechOptions };

// Tracks whatever's currently playing so stopElevenLabsSpeech() can interrupt
// it — mirrors expo-speech's Speech.stop() being a single global "stop now".
let current: { player: AudioPlayer; file: File } | null = null;
let queue: QueueItem[] = [];
let playing = false;
// Bumped whenever the queue is forcibly cleared, so an in-flight fetch/synthesis
// for a discarded item can detect it's stale and skip playing stale audio over
// whatever replaced it (speakWithElevenLabs racing an in-progress enqueue chain).
let epoch = 0;

function cleanupCurrent() {
  if (!current) return;
  const { player, file } = current;
  current = null;
  player.release();
  file.delete();
}

export function stopElevenLabsSpeech(): void {
  epoch += 1;
  queue = [];
  playing = false;
  cleanupCurrent();
}

async function playNext(forEpoch: number): Promise<void> {
  const item = queue.shift();
  if (!item) {
    if (forEpoch === epoch) playing = false;
    return;
  }
  playing = true;

  let file: File | null = null;
  try {
    const response = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${VOICE_ID}?output_format=mp3_44100_128`, {
      method: 'POST',
      headers: {
        'xi-api-key': getElevenLabsApiKey(),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ text: item.text, model_id: MODEL_ID }),
    });
    if (!response.ok) {
      const body = await response.text();
      throw new Error(`ElevenLabs request failed (${response.status}): ${body}`);
    }

    const bytes = new Uint8Array(await response.arrayBuffer());
    if (forEpoch !== epoch) return; // superseded while fetching — drop it silently
    file = new File(Paths.cache, `talk-reply-${Date.now()}.mp3`);
    file.create();
    file.write(bytes);

    const player = createAudioPlayer({ uri: file.uri });
    player.setPlaybackRate(item.options?.rate ?? 1.0, 'high');
    current = { player, file };

    const subscription = player.addListener('playbackStatusUpdate', (status) => {
      if (status.didJustFinish || status.error) {
        subscription.remove();
        cleanupCurrent();
        item.options?.onSettled?.();
        playNext(forEpoch);
      }
    });
    player.play();
  } catch (err) {
    console.warn('ElevenLabs TTS failed', err);
    file?.delete();
    if (forEpoch === epoch) {
      item.options?.onSettled?.();
      playNext(forEpoch);
    }
  }
}

// Queues text to play after anything already queued/playing finishes — lets a
// streamed reply speak sentence-by-sentence as each one arrives, instead of
// waiting for the full reply before synthesis can even start.
export function enqueueElevenLabsSpeech(text: string, options?: SpeechOptions): void {
  queue.push({ text, options });
  if (!playing) playNext(epoch);
}

// Plays immediately, discarding anything queued/in-progress — the "only one
// reply plays at a time" behavior the non-streaming call sites (goodbye,
// error fallback) rely on.
export function speakWithElevenLabs(text: string, options?: SpeechOptions): void {
  stopElevenLabsSpeech();
  enqueueElevenLabsSpeech(text, options);
}
