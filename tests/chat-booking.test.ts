import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { addDays, localDate, seedServices } from '../shared/domain';
import { initialChatState, type ChatState, type ConversationMessage } from '../shared/conversation';

const dir = mkdtempSync(join(tmpdir(), 'autoagenda-chat-'));
let chat: typeof import('../server/chat').chat;
let getBookings: typeof import('../server/store').getBookings;
let date = addDays(localDate(), 3);
while (new Date(`${date}T12:00:00-03:00`).getUTCDay() === 0) date = addDays(date, 1);
const br = date.split('-').reverse().join('/');

beforeAll(async () => {
  process.env.DEMO_DATA_FILE = join(dir, 'data.json');
  delete process.env.SUPABASE_URL;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  delete process.env.SUPABASE_ANON_KEY;
  delete process.env.OPENAI_API_KEY;
  process.env.AI_PROVIDER = 'demo';
  ({ chat } = await import('../server/chat'));
  ({ getBookings } = await import('../server/store'));
});
afterAll(() => rmSync(dir, { recursive: true, force: true }));

/** Plays a conversation the way the browser does, carrying history and state. */
async function talk(lines: string[]) {
  let history: ConversationMessage[] = [];
  let state: ChatState = initialChatState();
  const replies: string[] = [];
  for (const text of lines) {
    const result = await chat(text, history, state);
    history = [...history, { role: 'customer', text }, { role: 'assistant', text: result.message }];
    state = result.state;
    replies.push(result.message);
  }
  return { replies, state };
}

describe('booking inside the conversation', () => {
  it('offers slots, collects details and books only after an explicit yes', async () => {
    const before = (await getBookings()).length;
    const { replies, state } = await talk([
      `quero um polimento ${br} à tarde`,
      '1',
      'meu nome é Ana',
      'Civic prata',
      '11988887777',
    ]);
    expect(replies[0]).toContain('1) Entrada 12:00');
    expect(replies[0]).toContain('R$');
    expect(replies[1]).toContain('qual é o seu nome');
    expect(replies[2]).toContain('Ana');
    expect(replies[3]).toContain('telefone com DDD');
    expect(replies[4]).toContain('Posso confirmar?');
    expect(replies[4]).toContain('(11) 98888-7777');
    expect(state.stage).toBe('confirming');
    expect((await getBookings()).length).toBe(before);

    const done = await chat('sim', [], state);
    expect(done.message).toContain('reserva confirmada');
    expect(done.state.stage).toBe('booked');
    const booking = (await getBookings()).at(-1)!;
    expect(booking).toMatchObject({
      service_id: seedServices[1].id,
      customer_name: 'Ana',
      vehicle: 'Civic prata',
      phone: '(11) 98888-7777',
      starts_at: `${date}T15:00:00.000Z`,
    });
  });

  it('goes straight to the details when the requested time is free, and re-offers on "não"', async () => {
    const { replies, state } = await talk([
      `lavagem ${br} às 9h`,
      'Bruno',
      'Gol branco',
      '(21) 3333-4444',
      'não',
      '1',
    ]);
    expect(replies[0]).toContain('entrada às 09:00');
    expect(replies[4]).toContain('não reservei');
    // The details are kept: choosing another slot goes straight to the summary.
    expect(replies[5]).toContain('Posso confirmar?');
    expect(replies[5]).toContain('(21) 3333-4444');
    expect(state.stage).toBe('confirming');
  });

  it('does not offer a slot taken by the previous booking and keeps the request on a change of day', async () => {
    const { replies, state } = await talk([`lavagem ${br} à tarde`, 'às 12h', 'polimento']);
    expect(replies[0]).toContain('1) Entrada 16:00');
    expect(replies[1]).toContain('Às 12:00 não tenho horário livre');
    expect(state).toMatchObject({ service_id: seedServices[1].id, date });
  });

  it('starts a fresh request after a booking', async () => {
    const { replies } = await talk([
      `higienização ${br} de manhã`,
      '1',
      'Carla',
      'Onix',
      '+55 11 97777-6666',
      'sim',
      `quero uma lavagem ${br}`,
    ]);
    expect(replies[5]).toContain('reserva confirmada');
    expect(replies[6]).toContain('Lavagem detalhada');
    expect(replies[6]).toContain('1) Entrada');
  });
});

describe('questions in the conversation (local mode)', () => {
  it('explains a service and keeps it for the booking that follows', async () => {
    const { replies, state } = await talk(['como funciona a lavagem?', `${br} à tarde`]);
    expect(replies[0]).toContain(seedServices[0].description);
    expect(replies[0]).toContain('R$');
    expect(replies[1]).toContain('1) Entrada');
    expect(state).toMatchObject({ stage: 'choosing', service_id: seedServices[0].id });
  });
  it('answers a question during the details and asks the pending step again', async () => {
    const { replies, state } = await talk([`lavagem ${br} às 16h`, 'quanto tempo demora?']);
    expect(replies[1]).toContain('Duração aproximada');
    expect(replies[1]).toContain('qual é o seu nome?');
    expect(replies[1]).not.toContain('Quer agendar');
    expect(state.stage).toBe('name');
  });
});

describe('customer name', () => {
  it('capitalises a name typed in lower case', async () => {
    const { replies } = await talk([`lavagem ${br} às 16h`, 'joão da silva']);
    expect(replies[1]).toContain('Obrigado, João da Silva!');
  });
});

describe('phone', () => {
  it('formats Brazilian numbers and rejects invalid ones', async () => {
    const { parsePhone } = await import('../server/chat');
    expect(parsePhone('11988887777')).toBe('(11) 98888-7777');
    expect(parsePhone('+55 (21) 3333-4444')).toBe('(21) 3333-4444');
    expect(parsePhone('12345')).toBeNull();
  });
  it('asks again for an invalid phone and skips the question when the channel knows it', async () => {
    const { replies } = await talk([`lavagem ${br} às 16h`, 'Dani', 'Fox preto', 'não sei']);
    expect(replies[2]).toContain('telefone com DDD');
    expect(replies[3]).toContain('Pode me passar o telefone');
    const direct = await chat(
      'Fox preto',
      [],
      {
        ...initialChatState(),
        stage: 'vehicle',
        service_id: seedServices[0].id,
        date,
        customer_name: 'Dani',
        chosen: { starts_at: `${date}T19:00:00.000Z`, ends_at: `${date}T20:30:00.000Z` },
        price_cents: 15000,
        duration_minutes: 90,
      },
      '+55 11 96666-5555',
    );
    expect(direct.message).toContain('(11) 96666-5555');
    expect(direct.state.stage).toBe('confirming');
  });
});

describe('full day', () => {
  it('offers another period or the next day instead of a dead end', async () => {
    // The afternoon of this date already has the polishing booked in the first test.
    const { replies, state } = await talk([`polimento ${br} à tarde`]);
    expect(replies[0]).toContain('Não tenho horário livre para polimento geral');
    expect(replies[0]).toMatch(/No mesmo dia, tenho:|O próximo dia com horário livre é:/);
    expect(replies[0]).toContain('1) Entrada');
    expect(state.stage).toBe('choosing');
  });
});

describe('availability questions', () => {
  it('lists the next days with free slots instead of describing the service', async () => {
    const { replies, state } = await talk(['quais dias disponiveis para polimento', 'segunda']);
    expect(replies[0]).toContain('Próximos dias com horário livre:');
    expect(replies[0]).toMatch(/• \S+.*: a partir das \d{2}:\d{2}/);
    expect(replies[0]).toContain('Qual dia prefere?');
    expect(state.service_id).toBe(seedServices[1].id);
    expect(replies[1]).toContain('Polimento geral');
  });
});
