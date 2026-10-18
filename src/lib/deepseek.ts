import { getDeepSeekApiKey } from '@/lib/env';

export type ChatMessage = { role: 'system' | 'user' | 'assistant'; content: string };

export async function chatComplete(messages: ChatMessage[], options?: { json?: boolean }): Promise<string> {
  const response = await fetch('https://api.deepseek.com/chat/completions', {
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
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`DeepSeek request failed (${response.status}): ${body}`);
  }

  const data = await response.json();
  return data.choices[0].message.content;
}
