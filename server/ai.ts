export function aiProvider(): 'demo' | 'openai' | 'ollama' {
  if (process.env.AI_PROVIDER === 'ollama') return 'ollama';
  if (process.env.AI_PROVIDER === 'demo') return 'demo';
  return process.env.OPENAI_API_KEY ? 'openai' : 'demo';
}
