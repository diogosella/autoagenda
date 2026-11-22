import { createHmac, timingSafeEqual } from 'node:crypto';
import { chat } from './chat.ts';
import { getConversation, saveConversation } from './store.ts';
import { initialChatState, type ConversationMessage } from '../shared/conversation.ts';

/**
 * WhatsApp Cloud API (Meta) channel: receives customer messages through the webhook, runs them
 * through the same chat() the panel simulator uses, keeps the conversation per phone number and
 * answers through the Graph API.
 */
export const whatsappConfig = () => ({
  verifyToken: process.env.WHATSAPP_VERIFY_TOKEN || '',
  accessToken: process.env.WHATSAPP_ACCESS_TOKEN || '',
  phoneNumberId: process.env.WHATSAPP_PHONE_NUMBER_ID || '',
  appSecret: process.env.WHATSAPP_APP_SECRET || '',
  version: process.env.WHATSAPP_GRAPH_VERSION || 'v25.0',
});
export const whatsappEnabled = () => {
  const c = whatsappConfig();
  return Boolean(c.verifyToken && c.accessToken && c.phoneNumberId);
};

/** X-Hub-Signature-256 = "sha256=" + HMAC-SHA256(raw body, app secret). Skipped without a secret. */
export function validSignature(
  raw: Buffer | undefined,
  header: string | undefined,
  secret: string,
) {
  if (!secret) return true;
  if (!raw || !header?.startsWith('sha256=')) return false;
  const expected = Buffer.from(`sha256=${createHmac('sha256', secret).update(raw).digest('hex')}`);
  const received = Buffer.from(header);
  return received.length === expected.length && timingSafeEqual(received, expected);
}

type Inbound = { id: string; from: string; text: string | null; name?: string };

/** Customer messages in a webhook payload; status updates (sent, delivered, read) are ignored. */
export function extractMessages(payload: unknown): Inbound[] {
  const result: Inbound[] = [];
  const entries = (payload as { entry?: unknown[] })?.entry;
  if (!Array.isArray(entries)) return result;
  for (const entry of entries as { changes?: { field?: string; value?: any }[] }[])
    for (const change of entry.changes || []) {
      const value = change.value;
      if (change.field !== 'messages' || !Array.isArray(value?.messages)) continue;
      for (const m of value.messages) {
        if (typeof m?.id !== 'string' || typeof m?.from !== 'string') continue;
        const contact = (value.contacts || []).find((c: any) => c?.wa_id === m.from);
        result.push({
          id: m.id,
          from: m.from.replace(/\D/g, ''),
          text: m.type === 'text' && typeof m.text?.body === 'string' ? m.text.body : null,
          name: contact?.profile?.name,
        });
      }
    }
  return result;
}

const SESSION_MS = 24 * 60 * 60 * 1000; // a new request after a day starts a fresh conversation
const MAX_HISTORY = 60;
const KEEP_HISTORY = 40;
const seen = new Set<string>(); // Meta may deliver the same message more than once
const queues = new Map<string, Promise<void>>(); // one message at a time per customer
const workingNumber = new Map<string, string>(); // wa_id → number that accepted our reply

/** Delivery failures reported later by Meta (status "failed"), logged so they are not silent. */
export function failedStatuses(payload: unknown) {
  const result: { to: string; code?: number; detail: string }[] = [];
  for (const entry of ((payload as { entry?: any[] })?.entry || []) as any[])
    for (const change of entry?.changes || [])
      for (const st of change?.value?.statuses || [])
        if (st?.status === 'failed')
          for (const e of st.errors?.length ? st.errors : [{}])
            result.push({
              to: String(st.recipient_id || '?'),
              code: e.code,
              detail: e.error_data?.details || e.message || e.title || 'sem detalhes',
            });
  return result;
}
const tail = (phone: string) => `…${phone.slice(-4)}`;

/** Processes every customer message in a webhook payload. */
export async function handleWebhook(payload: unknown) {
  for (const f of failedStatuses(payload))
    console.error(
      `WhatsApp: a Meta não entregou a resposta para ${tail(f.to)} (${f.code ?? '?'}): ${f.detail}`,
    );
  await Promise.all(
    extractMessages(payload).map((m) => {
      const previous = queues.get(m.from) || Promise.resolve();
      const next = previous
        .then(() => handleMessage(m))
        .catch((error) => console.error('WhatsApp:', (error as Error).message));
      queues.set(m.from, next);
      void next.finally(() => queues.get(m.from) === next && queues.delete(m.from));
      return next;
    }),
  );
}

async function handleMessage(m: Inbound) {
  if (seen.has(m.id)) return;
  seen.add(m.id);
  if (seen.size > 2000) seen.delete(seen.values().next().value!);
  void markRead(m.id);
  if (!m.text?.trim()) {
    await sendText(
      m.from,
      'Por enquanto consigo ler só mensagens de texto. Pode me escrever o que você precisa?',
    );
    return;
  }
  const stored = await getConversation(m.from);
  const fresh = !stored || Date.now() - Date.parse(stored.updated_at) > SESSION_MS;
  let history: ConversationMessage[] = fresh ? [] : stored.history;
  let state = fresh ? initialChatState() : stored.state;
  const text = m.text.trim().slice(0, 500);
  console.log(`WhatsApp: mensagem de ${tail(m.from)} recebida; montando a resposta…`);
  const started = Date.now();
  let reply: string;
  try {
    const result = await chat(text, history, state, m.from);
    reply = result.message;
    state = result.state;
  } catch (error) {
    console.error('WhatsApp: falha ao montar a resposta:', (error as Error).message);
    reply =
      'Desculpe, não consegui consultar a agenda agora. Pode tentar de novo em alguns instantes?';
  }
  const now = new Date().toISOString();
  history = [
    ...history,
    { role: 'customer', text, sent_at: now },
    { role: 'assistant', text: reply.slice(0, 4000), sent_at: now },
  ];
  if (history.length > MAX_HISTORY) {
    const dropped = history.length - KEEP_HISTORY;
    history = history.slice(dropped);
    state = { ...state, context_from: Math.max(0, state.context_from - dropped) };
  }
  await saveConversation(m.from, { history, state, updated_at: now });
  console.log(
    `WhatsApp: resposta para ${tail(m.from)} pronta em ${((Date.now() - started) / 1000).toFixed(1)} s`,
  );
  await sendText(m.from, reply);
}

const graphUrl = () => {
  const c = whatsappConfig();
  return `https://graph.facebook.com/${c.version}/${c.phoneNumberId}/messages`;
};
const graphHeaders = () => ({
  Authorization: `Bearer ${whatsappConfig().accessToken}`,
  'Content-Type': 'application/json',
});

/**
 * Brazilian numbers may arrive without the mobile 9th digit (55 11 8888-7777) while the number
 * registered at Meta has it, or the other way round; the alternative spelling is tried once.
 */
export function brazilianVariant(number: string) {
  if (/^55\d{2}[6-9]\d{7}$/.test(number)) return `${number.slice(0, 4)}9${number.slice(4)}`;
  if (/^55\d{2}9\d{8}$/.test(number)) return `${number.slice(0, 4)}${number.slice(5)}`;
  return null;
}

export async function sendText(to: string, body: string) {
  const c = whatsappConfig();
  if (!c.accessToken || !c.phoneNumberId) {
    console.log(`WhatsApp (sem token configurado) → ${to}: ${body}`);
    return;
  }
  const send = (number: string) =>
    fetch(graphUrl(), {
      method: 'POST',
      headers: graphHeaders(),
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to: number,
        type: 'text',
        text: { preview_url: false, body: body.slice(0, 4096) },
      }),
      signal: AbortSignal.timeout(15000),
    });
  const first = workingNumber.get(to) || to;
  let response = await send(first);
  if (response.ok) {
    console.log(`WhatsApp: resposta aceita pela Meta para ${tail(first)}`);
    return;
  }
  let detail = (await response.json().catch(() => ({}))) as {
    error?: { code?: number; message?: string };
  };
  const alternative = brazilianVariant(first);
  if (alternative) {
    response = await send(alternative);
    if (response.ok) {
      workingNumber.set(to, alternative);
      console.log(
        `WhatsApp: resposta aceita pela Meta para ${tail(alternative)} (com ajuste do 9º dígito)`,
      );
      return;
    }
    detail = (await response.json().catch(() => ({}))) as typeof detail;
  }
  const code = detail.error?.code ?? response.status;
  console.error(
    `WhatsApp: a Meta recusou o envio para ${to} (${code}): ${detail.error?.message || 'sem detalhes'}` +
      (code === 131030
        ? ' — cadastre este número como destinatário no painel da Meta (API Setup).'
        : code === 190
          ? ' — o token de acesso expirou; gere outro e atualize WHATSAPP_ACCESS_TOKEN.'
          : ''),
  );
}

/** Marks the message as read and shows "typing…" while the assistant thinks (best effort). */
async function markRead(messageId: string) {
  const c = whatsappConfig();
  if (!c.accessToken || !c.phoneNumberId) return;
  try {
    await fetch(graphUrl(), {
      method: 'POST',
      headers: graphHeaders(),
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        status: 'read',
        message_id: messageId,
        typing_indicator: { type: 'text' },
      }),
      signal: AbortSignal.timeout(10000),
    });
  } catch {}
}
