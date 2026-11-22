import { afterEach, expect, it, vi } from 'vitest';
import { interpret } from '../server/intent';
import { seedServices } from '../shared/domain';
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});
it('uses local structured chat without thinking and preserves history', async () => {
  vi.stubEnv('AI_PROVIDER', 'ollama');
  vi.stubGlobal(
    'fetch',
    vi
      .fn()
      .mockResolvedValue({
        ok: true,
        json: async () => ({
          message: {
            content: JSON.stringify({
              service_id: seedServices[0].id,
              date: '2099-01-02',
              period: 'any',
              clarification: null,
            }),
          },
        }),
      }),
  );
  const result = await interpret('04/12/2099', seedServices, [
    { role: 'customer', text: 'quero lavar meu carro' },
  ]);
  expect(result.date).toBe('2099-12-04');
  const [url, options] = vi.mocked(fetch).mock.calls[0];
  expect(url).toBe('http://127.0.0.1:11434/api/chat');
  const body = JSON.parse(String(options!.body));
  expect(body.think).toBe(false);
  expect(body.stream).toBe(false);
  expect(body.messages[1].content).toBe('quero lavar meu carro');
  expect(body.format.required).toContain('service_id');
  expect(options!.headers).not.toHaveProperty('Authorization');
});
it('reports an offline local model without falling back to rules', async () => {
  vi.stubEnv('AI_PROVIDER', 'ollama');
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
  await expect(interpret('lavar amanhã', seedServices)).rejects.toThrow(
    'Não foi possível acessar a IA',
  );
});
