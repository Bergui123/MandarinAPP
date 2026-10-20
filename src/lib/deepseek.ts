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
