import { afterEach, describe, expect, it, vi } from 'vitest';
import { interpret } from '../server/intent';
import { addDays, localDate, seedServices } from '../shared/domain';
import { defaultSettings } from '../shared/settings';
// Next Friday, matching "sexta" in the request whatever day the suite runs.
let friday = addDays(localDate(), 1);
while (new Date(`${friday}T12:00:00-03:00`).getUTCDay() !== 5) friday = addDays(friday, 1);
const intent = {
  service_id: seedServices[1].id,
  date: friday,
  period: 'afternoon',
  clarification: null,
};
function mockOutput(text: string, ok = true) {
  vi.stubEnv('OPENAI_API_KEY', 'test-key-never-sent');
  return vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({
      ok,
      json: async () => ({ output: [{ content: [{ type: 'output_text', text }] }] }),
    }),
  );
}
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});
describe('AI boundary with a mocked provider', () => {
  it('sends contextual history and original message dates to the model', async () => {
    mockOutput(JSON.stringify(intent));
    await interpret('quarta da semana depois da que vem', seedServices, [
      { role: 'customer', text: 'quero lavar meu carro', sent_at: '2026-11-21T14:00:00.000Z' },
    ]);
    const request = JSON.parse(String(vi.mocked(fetch).mock.calls[0][1]!.body));
    expect(request.input[0].content).toContain('2026-11-21');
    expect(request.input[0].content).toContain('quero lavar meu carro');
    expect(request.input[1].content).toBe('quarta da semana depois da que vem');
    expect(request.instructions).toContain('preserve serviço, data e período');
    expect(request.instructions).toContain('descrições do catálogo');
  });
  it('uses structured extraction and returns only intent', async () => {
    mockOutput(JSON.stringify(intent));
    expect(await interpret('polimento sexta à tarde', seedServices)).toEqual(intent);
    const call = vi.mocked(fetch).mock.calls[0];
    const request = JSON.parse(String(call[1]!.body));
    expect(request.text.format.strict).toBe(true);
    expect(request.store).toBe(false);
    expect(request.instructions).not.toContain('customer_name');
    expect(request.input).toBe('polimento sexta à tarde');
  });
  it('rejects an invented service ID even in valid JSON', async () => {
    mockOutput(JSON.stringify({ ...intent, service_id: 'unknown-service' }));
    await expect(interpret('teste', seedServices)).rejects.toThrow('Não encontrei esse serviço');
  });
  it('rejects malformed output, impossible dates and invalid periods', async () => {
    for (const value of [
      'not json',
      JSON.stringify({ ...intent, date: '2026-02-30' }),
      JSON.stringify({ ...intent, period: 'night' }),
    ]) {
      mockOutput(value);
      await expect(interpret('teste', seedServices)).rejects.toThrow();
    }
  });
  it('keeps the model date for context-dependent phrases', async () => {
    const later = addDays(friday, 7);
    mockOutput(JSON.stringify({ ...intent, date: later }));
    const result = await interpret('pode ser uma semana depois', seedServices, [
      { role: 'customer', text: 'polimento sexta' },
    ]);
    expect(result).toMatchObject({ date: later, clarification: null });
  });
  it('asks again when the model returns a past date', async () => {
    mockOutput(JSON.stringify({ ...intent, date: addDays(localDate(), -3) }));
    expect(await interpret('lavagem', seedServices)).toMatchObject({
      date: null,
      clarification: expect.stringContaining('já passou'),
    });
  });
  it('reports provider failure without silently simulating AI', async () => {
    mockOutput('', false);
    await expect(interpret('polimento sexta', seedServices)).rejects.toThrow(
      'assistente está indisponível',
    );
  });
});
describe('service codes', () => {
  it('sends short codes instead of IDs and maps them back', async () => {
    mockOutput(JSON.stringify({ ...intent, service_id: 'S2' }));
    expect(await interpret('polimento sexta à tarde', seedServices)).toEqual(intent);
    const request = JSON.parse(String(vi.mocked(fetch).mock.calls[0][1]!.body));
    expect(request.instructions).toContain('S2: Polimento geral');
    expect(request.instructions).not.toContain(seedServices[0].id);
  });
  it('never shows internal codes or IDs to the customer', async () => {
    mockOutput(
      JSON.stringify({
        service_id: null,
        date: null,
        period: 'any',
        clarification: `Não fazemos pintura. Temos: ${seedServices[0].id} | Lavagem detalhada, S2 | Polimento geral.`,
      }),
    );
    const result = await interpret('quero pintar o carro', seedServices);
    expect(result.clarification).not.toMatch(/[0-9a-f]{8}-|S2/);
    expect(result.clarification).toContain('Lavagem detalhada');
  });
});
describe('answers to customer questions', () => {
  const ask = (answer: string, service_id: string | null = 'S1') =>
    mockOutput(
      JSON.stringify({ service_id, date: null, period: 'any', answer, clarification: null }),
    );
  it('keeps a grounded answer and turns codes into names', async () => {
    ask('A S1 limpa o carro (S1) por dentro e por fora, custa R$ 150,00 e leva cerca de 1h 30min.');
    const result = await interpret('como funciona a lavagem?', seedServices);
    expect(result.service_id).toBe(seedServices[0].id);
    expect(result.answer).toContain('A Lavagem detalhada limpa o carro por dentro');
    expect(result.clarification).toBeNull();
    const request = JSON.parse(String(vi.mocked(fetch).mock.calls[0][1]!.body));
    expect(request.instructions).toContain('R$');
    expect(request.text.format.schema.required).toContain('answer');
  });
  it('ignores an explanation when the customer is not asking anything', async () => {
    ask('Lavagem detalhada: limpeza por dentro e por fora. Quer agendar?');
    const result = await interpret('isso', seedServices, [
      { role: 'customer', text: 'como funciona a lavagem?' },
    ]);
    expect(result.answer).toBeUndefined();
    expect(result.service_id).toBe(seedServices[0].id);
    expect(result.clarification).toContain('Para qual dia');
  });
  it('drops a clarification that only repeats the previous explanation', async () => {
    const explanation = 'A lavagem detalhada custa R$ 150,00. Quer agendar?';
    mockOutput(
      JSON.stringify({
        service_id: 'S1',
        date: null,
        period: 'any',
        answer: null,
        clarification: explanation,
      }),
    );
    const result = await interpret('isso', seedServices, [
      { role: 'customer', text: 'como funciona a lavagem?' },
      { role: 'assistant', text: explanation },
    ]);
    expect(result.clarification).toContain('Para qual dia você gostaria de agendar lavagem');
  });
  it('adds the store notice whenever an answer mentions a price', async () => {
    ask('A lavagem custa R$ 150,00. Quer agendar?');
    const result = await interpret('quanto custa a lavagem?', seedServices, [], {
      ...defaultSettings,
      delivery_notice: 'O valor pode variar conforme o porte do veículo.',
    });
    expect(result.answer).toBe(
      'A lavagem custa R$ 150,00. O valor pode variar conforme o porte do veículo. Quer agendar?',
    );
  });
  it('replaces an answer with an invented price by the catalog description', async () => {
    ask('A lavagem custa R$ 99,00.');
    const result = await interpret('quanto custa a lavagem?', seedServices);
    expect(result.answer).not.toContain('99');
    expect(result.answer).toContain(seedServices[0].description);
  });
});

describe('dates and days the model gets wrong', () => {
  let wednesday = addDays(localDate(), 1);
  while (new Date(`${wednesday}T12:00:00-03:00`).getUTCDay() !== 3)
    wednesday = addDays(wednesday, 1);
  it('"na outra quarta" is the Wednesday after the next one', async () => {
    mockOutput(
      JSON.stringify({
        service_id: 'S1',
        date: wednesday,
        period: 'any',
        answer: null,
        clarification: null,
      }),
    );
    const result = await interpret('na outra quarta', seedServices, [
      { role: 'customer', text: 'lavagem quarta' },
    ]);
    expect(result.date).toBe(addDays(wednesday, 7));
  });
  it('asks for the day with the real working days instead of the model text', async () => {
    mockOutput(
      JSON.stringify({
        service_id: 'S1',
        date: null,
        period: 'any',
        answer: null,
        clarification: 'Qual dia você prefere? (segunda a sexta)',
      }),
    );
    const result = await interpret('gostaria de fazer isso', seedServices, [], defaultSettings);
    expect(result.clarification).toContain('Atendemos de segunda a sábado, das 08:00 às 18:00');
    expect(result.clarification).not.toContain('sexta)');
  });
});

describe('store facts in answers', () => {
  const answerWith = (answer: string) =>
    mockOutput(
      JSON.stringify({ service_id: 'S2', date: null, period: 'any', answer, clarification: null }),
    );
  it('replaces invented opening days or availability with the real ones', async () => {
    answerWith(
      'A loja está aberta de segunda a sexta, das 08:00 às 18:00. Para o polimento geral, temos disponibilidade na sexta.',
    );
    const result = await interpret('vocês abrem que dias?', seedServices, [], defaultSettings);
    expect(result.answer).toContain('Atendemos de segunda a sábado, das 08:00 às 18:00.');
    expect(result.answer).not.toContain('disponibilidade');
  });
  it('keeps an answer whose days and hours match the rules', async () => {
    answerWith('Atendemos de segunda a sábado, das 8h às 18h. Quer agendar?');
    const result = await interpret('que horas vocês abrem?', seedServices, [], defaultSettings);
    expect(result.answer).toBe('Atendemos de segunda a sábado, das 8h às 18h. Quer agendar?');
  });
});
