export function getDeepSeekApiKey(): string {
  const key = process.env.EXPO_PUBLIC_DEEPSEEK_API_KEY;
  if (!key) {
    throw new Error('Missing EXPO_PUBLIC_DEEPSEEK_API_KEY — copy .env.example to .env and add your DeepSeek key');
  }
  return key;
}
