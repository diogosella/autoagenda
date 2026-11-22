import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Server } from 'node:http';
import { createHmac } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { addDays, localDate } from '../shared/domain';

const dir = mkdtempSync(join(tmpdir(), 'autoagenda-whatsapp-'));
const SECRET = 'segredo-do-app';
let server: Server;
let base: string;
let handleWebhook: typeof import('../server/whatsapp').handleWebhook;
let getBookings: typeof import('../server/store').getBookings;
let date = addDays(localDate(), 3);
while (new Date(`${date}T12:00:00-03:00`).getUTCDay() === 0) date = addDays(date, 1);
const br = date.split('-').reverse().join('/');

// Graph API calls are captured; calls to the local test server go through the real fetch.
const realFetch = globalThis.fetch;
type Sent = { to?: string; type?: string; status?: string; text?: { body: string } };
let sent: Sent[] = [];
let graphReply: (body: Sent) => Response = () =>
  new Response(JSON.stringify({ messages: [{ id: 'wamid.out' }] }), { status: 200 });
vi.stubGlobal(
  'fetch',
  vi.fn((url: string | URL, init?: RequestInit) => {
    if (String(url).startsWith('https://graph.facebook.com/')) {
      const body = JSON.parse(String(init?.body)) as Sent;
      sent.push(body);
      return Promise.resolve(graphReply(body));
    }
    return realFetch(url, init);
  }),
);
const replies = () => sent.filter((s) => s.type === 'text');

let counter = 0;
const message = (from: string, text: string | null) => ({
  object: 'whatsapp_business_account',
  entry: [
    {
      id: 'WABA',
      changes: [
        {
          field: 'messages',
          value: {
            messaging_product: 'whatsapp',
            metadata: { phone_number_id: '123' },
            contacts: [{ wa_id: from, profile: { name: 'Cliente' } }],
            messages: [
              text === null
                ? { id: `wamid.${++counter}`, from, type: 'audio', audio: { id: 'a1' } }
                : { id: `wamid.${++counter}`, from, type: 'text', text: { body: text } },
            ],
          },
        },
      ],
    },
  ],
});
const sign = (raw: string) => `sha256=${createHmac('sha256', SECRET).update(raw).digest('hex')}`;

beforeAll(async () => {
  process.env.DEMO_DATA_FILE = join(dir, 'data.json');
  delete process.env.SUPABASE_URL;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  delete process.env.SUPABASE_ANON_KEY;
  delete process.env.OPENAI_API_KEY;
  process.env.AI_PROVIDER = 'demo';
  process.env.WHATSAPP_VERIFY_TOKEN = 'meu-token-de-verificacao';
  process.env.WHATSAPP_ACCESS_TOKEN = 'token-de-acesso';
  process.env.WHATSAPP_PHONE_NUMBER_ID = '123';
  process.env.WHATSAPP_APP_SECRET = SECRET;
  const { app } = await import('../server/app');
  ({ handleWebhook } = await import('../server/whatsapp'));
  ({ getBookings } = await import('../server/store'));
  server = await new Promise<Server>((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Missing port');
  base = `http://127.0.0.1:${address.port}`;
});
afterAll(async () => {
  await new Promise<void>((resolve) => {
    server.close(() => resolve());
    server.closeAllConnections();
  });
  rmSync(dir, { recursive: true, force: true });
});
beforeEach(() => {
  sent = [];
  graphReply = () =>
    new Response(JSON.stringify({ messages: [{ id: 'wamid.out' }] }), { status: 200 });
});

describe('webhook verification and security', () => {
  it('answers the Meta challenge only with the right verify token', async () => {
    const ok = await fetch(
      `${base}/api/whatsapp/webhook?hub.mode=subscribe&hub.verify_token=meu-token-de-verificacao&hub.challenge=12345`,
    );
    expect(ok.status).toBe(200);
    expect(await ok.text()).toBe('12345');
    const wrong = await fetch(
      `${base}/api/whatsapp/webhook?hub.mode=subscribe&hub.verify_token=outro&hub.challenge=12345`,
    );
    expect(wrong.status).toBe(403);
  });

  it('rejects messages without a valid Meta signature', async () => {
    const raw = JSON.stringify(message('5511900000001', 'oi'));
    for (const signature of [undefined, 'sha256=errada']) {
      const response = await fetch(`${base}/api/whatsapp/webhook`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(signature ? { 'X-Hub-Signature-256': signature } : {}),
        },
        body: raw,
      });
      expect(response.status).toBe(401);
    }
    expect(sent).toHaveLength(0);
  });

  it('accepts a signed message, answers 200 at once and replies through the Graph API', async () => {
    const raw = JSON.stringify(message('5511900000002', 'como funciona a lavagem?'));
    const response = await fetch(`${base}/api/whatsapp/webhook`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Hub-Signature-256': sign(raw) },
      body: raw,
    });
    expect(response.status).toBe(200);
    await vi.waitFor(() => expect(replies()).toHaveLength(1));
    expect(replies()[0]).toMatchObject({ to: '5511900000002' });
    expect(replies()[0].text!.body).toContain('Lavagem detalhada');
  });

  it('lets requests coming through a tunnel reach only the webhook', async () => {
    const tunnel = { 'X-Forwarded-For': '203.0.113.9' };
    expect((await fetch(`${base}/api/owner`, { headers: tunnel })).status).toBe(404);
    expect((await fetch(`${base}/api/config`, { headers: tunnel })).status).toBe(404);
    const challenge = await fetch(
      `${base}/api/whatsapp/webhook?hub.mode=subscribe&hub.verify_token=meu-token-de-verificacao&hub.challenge=ok`,
      { headers: tunnel },
    );
    expect(await challenge.text()).toBe('ok');
    // The panel, on the same machine, keeps working.
    expect((await fetch(`${base}/api/owner`)).status).toBe(200);
  });
});

describe('conversation over WhatsApp', () => {
  it('books with the phone taken from WhatsApp, without asking for it', async () => {
    const from = '5511988887777';
    const steps = [`quero uma lavagem ${br} às 16h`, 'Maria', 'Gol branco', 'sim'];
    for (const text of steps) await handleWebhook(message(from, text));
    const texts = replies().map((r) => r.text!.body);
    expect(texts).toHaveLength(4);
    expect(texts[0]).toContain('qual é o seu nome?');
    expect(texts[2]).toContain('Posso confirmar?');
    expect(texts[2]).toContain('(11) 98888-7777');
    expect(texts.join('\n')).not.toContain('telefone com DDD');
    expect(texts[3]).toContain('reserva confirmada');
    expect((await getBookings()).at(-1)).toMatchObject({
      customer_name: 'Maria',
      vehicle: 'Gol branco',
      phone: '(11) 98888-7777',
    });
  });

  it('keeps each customer’s conversation apart', async () => {
    await handleWebhook(message('5521911110000', 'quero um polimento'));
    await handleWebhook(message('5521922220000', 'quero uma higienização'));
    await handleWebhook(message('5521911110000', `${br} de manhã`));
    expect(replies().at(-1)!.text!.body).toContain('Polimento geral');
  });

  it('answers each message once, even when Meta delivers it twice', async () => {
    const payload = message('5531900000003', 'oi');
    await handleWebhook(payload);
    await handleWebhook(payload);
    expect(replies()).toHaveLength(1);
  });

  it('explains that only text is understood for audio or images', async () => {
    await handleWebhook(message('5531900000004', null));
    expect(replies()[0].text!.body).toContain('só mensagens de texto');
  });

  it('ignores delivery and read status updates', async () => {
    await handleWebhook({
      entry: [
        {
          changes: [
            {
              field: 'messages',
              value: { statuses: [{ id: 'wamid.x', status: 'delivered', recipient_id: '55' }] },
            },
          ],
        },
      ],
    });
    expect(sent).toHaveLength(0);
  });

  it('reads delivery failures reported later by Meta', async () => {
    const { failedStatuses } = await import('../server/whatsapp');
    const failed = failedStatuses({
      entry: [
        {
          changes: [
            {
              field: 'messages',
              value: {
                statuses: [
                  { id: 'a', status: 'delivered', recipient_id: '5511' },
                  {
                    id: 'b',
                    status: 'failed',
                    recipient_id: '5511988887777',
                    errors: [{ code: 131047, title: 'Re-engagement message' }],
                  },
                ],
              },
            },
          ],
        },
      ],
    });
    expect(failed).toEqual([
      { to: '5511988887777', code: 131047, detail: 'Re-engagement message' },
    ]);
  });

  it('retries a Brazilian number with the 9th digit when Meta refuses the first spelling', async () => {
    graphReply = (body) =>
      body.type === 'text' && body.to === '551188887777'
        ? new Response(
            JSON.stringify({
              error: { code: 131030, message: 'Recipient phone number not in allowed list' },
            }),
            { status: 400 },
          )
        : new Response(JSON.stringify({ messages: [{ id: 'wamid.out' }] }), { status: 200 });
    await handleWebhook(message('551188887777', 'oi'));
    expect(replies().map((r) => r.to)).toEqual(['551188887777', '5511988887777']);
    sent = [];
    await handleWebhook(message('551188887777', 'quero uma lavagem'));
    expect(replies().map((r) => r.to)).toEqual(['5511988887777']);
  });
});
