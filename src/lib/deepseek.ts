import { fetch as streamingFetch } from 'expo/fetch';

import { getDeepSeekApiKey } from '@/lib/env';

export type ChatMessage = { role: 'system' | 'user' | 'assistant'; content: string };

const TIMEOUT_MS = 15000;

export async function chatComplete(messages: ChatMessage[], options?: { json?: boolean }): Promise<string> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);

  let response: Response;
  try {
    response = await fetch('https://api.deepseek.com/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${getDeepSeekApiKey()}`,
      },
      body: JSON.stringify({
        model: 'deepseek-flash',
        messages,
        thinking: { type: 'disabled' },
        ...(options?.json ? { response_format: { type: 'json_object' } } : {}),
      }),
      signal: controller.signal,
    });
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      throw new Error(`DeepSeek request timed out after ${TIMEOUT_MS}ms`);
    }
    throw err;
  } finally {
    clearTimeout(timeout);
  }

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`DeepSeek request failed (${response.status}): ${body}`);
  }

  const data = await response.json();
  return data.choices[0].message.content;
}

// Streams the reply so the caller can start speaking the first sentence before
// the full completion has arrived — the non-streaming chatComplete() makes the
// reply wait for the entire response before any TTS synthesis even starts.
export async function chatCompleteStream(messages: ChatMessage[], onToken: (delta: string) => void): Promise<string> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);

  // The global fetch's response.body isn't a real streamable ReadableStream in
  // React Native — expo/fetch's is (see Expo's "Streaming fetch" docs), and is
  // required here to read the SSE chunks as they arrive.
  let response: Awaited<ReturnType<typeof streamingFetch>>;
  try {
    response = await streamingFetch('https://api.deepseek.com/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${getDeepSeekApiKey()}`,
      },
      body: JSON.stringify({ model: 'deepseek-flash', messages, thinking: { type: 'disabled' }, stream: true }),
      signal: controller.signal,
    });
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      throw new Error(`DeepSeek request timed out after ${TIMEOUT_MS}ms`);
    }
    throw err;
  } finally {
    clearTimeout(timeout);
  }

  if (!response.ok || !response.body) {
    const body = await response.text().catch(() => '');
    throw new Error(`DeepSeek request failed (${response.status}): ${body}`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let full = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    const lines = buffer.split('\n');
    buffer = lines.pop() ?? ''; // keep the last (possibly incomplete) line for next read
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith('data:')) continue;
      const payload = trimmed.slice('data:'.length).trim();
      if (payload === '[DONE]') continue;
      try {
        const parsed = JSON.parse(payload);
        const delta: string | undefined = parsed.choices?.[0]?.delta?.content;
        if (delta) {
          full += delta;
          onToken(delta);
        }
      } catch {
        // partial/malformed SSE chunk — skip it, the stream continues
      }
    }
  }

  return full;
}
