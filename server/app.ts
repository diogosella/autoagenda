import { aiProvider } from './ai.ts';
import { chat } from './chat.ts';
import { chatStateSchema, conversationSchema } from '../shared/conversation.ts';
import { settingsSchema } from '../shared/settings.ts';
import { getSettings, saveSettings } from './store.ts';
import express, { type Request, type Response, type NextFunction } from 'express';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import {
  AppError,
  db,
  shopId,
  getServices,
  getBookings,
  createBooking,
  saveService,
  changeStatus,
} from './store.ts';
import {
  bookingSchema,
  serviceSchema,
  slots,
  validDate,
  localDate,
  addDays,
} from '../shared/domain.ts';
import { interpret } from './intent.ts';
import { handleWebhook, validSignature, whatsappConfig, whatsappEnabled } from './whatsapp.ts';
export const app = express();
app.disable('x-powered-by');
app.use(
  express.json({
    limit: '128kb',
    // The raw bytes are kept to check the WhatsApp webhook signature.
    verify: (req, _res, buf) => {
      (req as Request & { rawBody?: Buffer }).rawBody = buf;
    },
  }),
);
// A tunnel (cloudflared, ngrok) exposes this API to the internet so Meta can reach the webhook.
// Requests that came through it carry forwarding headers and may reach ONLY the webhook.
const WEBHOOK = '/api/whatsapp/webhook';
app.use((req, res, next) => {
  const external = req.get('x-forwarded-for') || req.get('cf-connecting-ip');
  if (external && req.path !== WEBHOOK) {
    res.status(404).end();
    return;
  }
  next();
});
// Loopback-only API; refuse browser requests from an unrelated origin.
app.use('/api', (req, res, next) => {
  const origin = req.get('origin');
  if (
    origin &&
    ![
      'http://127.0.0.1:5173',
      'http://localhost:5173',
      `http://127.0.0.1:${process.env.PORT || 3001}`,
      `http://localhost:${process.env.PORT || 3001}`,
    ].includes(origin)
  ) {
    res.status(403).json({ error: 'Origem não permitida.' });
    return;
  }
  next();
});
const attempts = new Map<string, { count: number; reset: number }>();
app.use('/api', (req, res, next) => {
  if (req.method === 'GET' || req.originalUrl.startsWith(WEBHOOK)) return next();
  const key = `${req.ip}:${req.path}`;
  const now = Date.now();
  if (attempts.size > 1000) for (const [k, v] of attempts) if (v.reset < now) attempts.delete(k);
  const entry = attempts.get(key);
  if (!entry || entry.reset < now) attempts.set(key, { count: 1, reset: now + 60000 });
  else if (++entry.count > 20) {
    res.status(429).json({ error: 'Muitas tentativas. Aguarde um minuto.' });
    return;
  }
  next();
});
async function owner(req: Request, res: Response, next: NextFunction) {
  if (!db) return next();
  const token = req.get('authorization')?.replace(/^Bearer /, '');
  if (!token) {
    res.status(401).json({ error: 'Entre com a conta da loja.' });
    return;
  }
  const { data, error } = await db.auth.getUser(token);
  if (error || !data.user) {
    res.status(401).json({ error: 'Sua sessão expirou. Entre novamente.' });
    return;
  }
  const membership = await db
    .from('shop_members')
    .select('user_id')
    .eq('shop_id', shopId)
    .eq('user_id', data.user.id)
    .maybeSingle();
  if (!membership.data || membership.error) {
    res.status(403).json({ error: 'Sua conta não tem acesso a esta loja.' });
    return;
  }
  next();
}
app.get('/api/config', async (_req, res) => {
  res.json({
    shop: {
      id: shopId,
      name: 'Studio Auto',
      subtitle: 'Estética automotiva',
      timezone: 'America/Sao_Paulo',
    },
    mode: db ? 'supabase' : 'demo',
    ai: aiProvider(),
    whatsapp: whatsappEnabled(),
    auth: db ? { url: process.env.SUPABASE_URL, anonKey: process.env.SUPABASE_ANON_KEY } : null,
  });
});
// WhatsApp Cloud API webhook: Meta checks the URL once with GET, then POSTs each message.
app.get(WEBHOOK, (req, res) => {
  const { verifyToken } = whatsappConfig();
  if (
    verifyToken &&
    req.query['hub.mode'] === 'subscribe' &&
    req.query['hub.verify_token'] === verifyToken
  ) {
    res
      .status(200)
      .type('text/plain')
      .send(String(req.query['hub.challenge'] ?? ''));
    return;
  }
  res.status(403).end();
});
app.post(WEBHOOK, (req, res) => {
  const raw = (req as Request & { rawBody?: Buffer }).rawBody;
  if (!validSignature(raw, req.get('x-hub-signature-256'), whatsappConfig().appSecret)) {
    console.error('WhatsApp: assinatura inválida; mensagem descartada.');
    res.status(401).end();
    return;
  }
  // Meta expects a quick 200; the reply is sent afterwards through the Graph API.
  res.status(200).end();
  void handleWebhook(req.body).catch((error) => console.error('WhatsApp:', error.message));
});
app.get('/api/services', async (_req, res) =>
  res.json((await getServices()).filter((s) => s.active)),
);
const availabilityQuery = z.object({
  service_id: z.uuid(),
  date: z
    .string()
    .refine(validDate)
    .refine(
      (d) => d >= localDate() && d <= addDays(localDate(), 180),
      'Escolha uma data nos próximos 180 dias',
    ),
  period: z.enum(['morning', 'afternoon', 'any']).default('any'),
});
app.get('/api/availability', async (req, res) => {
  const q = availabilityQuery.parse(req.query);
  const service = (await getServices()).find((s) => s.id === q.service_id && s.active);
  if (!service) throw new AppError('Serviço indisponível.', 404);
  const busy = (await getBookings()).filter((b) => b.status !== 'cancelled');
  const rules = await getSettings();
  res.json({
    service,
    slots: slots(q.date, service.duration_minutes, busy, q.period, new Date(), rules),
    delivery_notice: rules.delivery_notice,
  });
});
app.post('/api/bookings', async (req, res) => {
  const input = bookingSchema.parse(req.body);
  const date = localDate(new Date(input.starts_at));
  if (date > addDays(localDate(), 180))
    throw new AppError('Agendamentos disponíveis para os próximos 180 dias.');
  res.status(201).json(await createBooking(input));
});
app.post('/api/interpret', async (req, res) => {
  const { text, history } = z
    .object({ text: z.string().trim().min(1).max(500), history: conversationSchema.default([]) })
    .parse(req.body);
  res.json(
    await interpret(
      text,
      (await getServices()).filter((s) => s.active),
      history,
    ),
  );
});
app.post('/api/owner/chat', owner, async (req, res) => {
  const { text, history, state, phone } = z
    .object({
      text: z.string().trim().min(1).max(500),
      history: conversationSchema.default([]),
      state: chatStateSchema.default(chatStateSchema.parse({})),
      /** Number the WhatsApp simulator pretends the customer writes from. */
      phone: z.string().trim().max(25).optional(),
    })
    .parse(req.body);
  res.json(await chat(text, history, state, phone));
});
app.get('/api/owner', owner, async (_req, res) =>
  res.json({ services: await getServices(), bookings: await getBookings() }),
);
app.post('/api/owner/services', owner, async (req, res) => {
  const service = serviceSchema.parse(req.body);
  const id = req.body.id ? z.uuid().parse(req.body.id) : randomUUID();
  if (req.body.id && !(await getServices()).some((s) => s.id === id))
    throw new AppError('Serviço não encontrado.', 404);
  await saveService({ ...service, id });
  res.json({ id });
});
app.patch('/api/owner/bookings/:id', owner, async (req, res) => {
  const { status } = z.object({ status: z.enum(['completed', 'cancelled']) }).parse(req.body);
  await changeStatus(z.uuid().parse(req.params.id), status);
  res.json({ ok: true });
});
app.get('/api/owner/settings', owner, async (_req, res) => res.json(await getSettings()));
app.put('/api/owner/settings', owner, async (req, res) => {
  const settings = settingsSchema.parse(req.body);
  await saveSettings(settings);
  res.json(settings);
});
app.use('/api', (_req, res) => res.status(404).json({ error: 'Rota não encontrada.' }));
app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  if (err instanceof z.ZodError) {
    res
      .status(400)
      .json({ error: err.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ') });
    return;
  }
  if (err instanceof AppError) {
    res.status(err.status).json({ error: err.message });
    return;
  }
  if (err instanceof SyntaxError) {
    res.status(400).json({ error: 'JSON inválido.' });
    return;
  }
  console.error(err instanceof Error ? err.message : 'Erro inesperado');
  res.status(500).json({ error: 'Não foi possível concluir. Tente novamente.' });
});
