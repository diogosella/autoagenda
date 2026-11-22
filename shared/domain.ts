import { defaultSettings, type Settings } from './settings';
import { z } from 'zod';

export const SHOP_ID = '10000000-0000-4000-8000-000000000001';
export const TIMEZONE = 'America/Sao_Paulo';
export const DISCLAIMER =
  'O valor e a previsão de entrega podem variar conforme o porte do veículo e o estado da pintura e do interior. A loja avalia o carro na chegada e confirma o valor antes de iniciar o serviço.';
export type Service = {
  id: string;
  shop_id: string;
  name: string;
  description: string;
  price_cents: number;
  duration_minutes: number;
  active: boolean;
};
export type Booking = {
  id: string;
  shop_id: string;
  service_id: string;
  service_name: string;
  price_cents: number;
  duration_minutes: number;
  starts_at: string;
  ends_at: string;
  customer_name: string;
  phone: string;
  vehicle: string;
  status: 'confirmed' | 'completed' | 'cancelled';
};
export type Busy = Pick<Booking, 'starts_at' | 'ends_at'>;
export type Intent = {
  service_id: string | null;
  date: string | null;
  period: 'morning' | 'afternoon' | 'any';
  clarification: string | null;
  /** Answer to an informational question, grounded in the catalog and store info. */
  answer?: string | null;
};
export const serviceSchema = z.object({
  name: z.string().trim().min(3).max(80),
  description: z.string().trim().max(240),
  price_cents: z.number().int().min(100).max(10000000),
  duration_minutes: z.number().int().min(30).max(600).multipleOf(30),
  active: z.boolean(),
});
export const bookingSchema = z.object({
  service_id: z.uuid(),
  starts_at: z.iso.datetime({ offset: true }),
  customer_name: z.string().trim().min(2).max(80),
  phone: z
    .string()
    .trim()
    .regex(/^\+?[\d\s()-]{10,20}$/, 'Informe um telefone válido'),
  vehicle: z.string().trim().min(2).max(100),
  accepted_estimate: z.literal(true),
  expected_price_cents: z.number().int().positive(),
  expected_duration_minutes: z.number().int().positive(),
});
export type BookingInput = z.infer<typeof bookingSchema>;
export const money = (cents: number) =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(cents / 100);
export const duration = (minutes: number) =>
  `${Math.floor(minutes / 60) ? `${Math.floor(minutes / 60)}h` : ''}${minutes % 60 ? ` ${minutes % 60}min` : ''}`.trim();
export const localDate = (date = new Date()) =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone: TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
export const clock = (date: string) =>
  new Intl.DateTimeFormat('pt-BR', {
    timeZone: TIMEZONE,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(new Date(date));
export const dayLabel = (date: string) =>
  new Intl.DateTimeFormat('pt-BR', {
    timeZone: TIMEZONE,
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  }).format(new Date(`${date}T12:00:00-03:00`));
export function addDays(date: string, days: number) {
  const d = new Date(`${date}T12:00:00-03:00`);
  d.setUTCDate(d.getUTCDate() + days);
  return localDate(d);
}
export function validDate(date: string) {
  return (
    /^\d{4}-\d{2}-\d{2}$/.test(date) &&
    !Number.isNaN(Date.parse(`${date}T12:00:00-03:00`)) &&
    localDate(new Date(`${date}T12:00:00-03:00`)) === date
  );
}
export function overlaps(a: Busy, b: Busy) {
  return (
    Date.parse(a.starts_at) < Date.parse(b.ends_at) &&
    Date.parse(a.ends_at) > Date.parse(b.starts_at)
  );
}
export function slots(
  date: string,
  minutes: number,
  busy: Busy[],
  period: Intent['period'] = 'any',
  now = new Date(),
  rules: Settings = defaultSettings,
): Busy[] {
  if (
    !validDate(date) ||
    !rules.days.includes(new Date(`${date}T12:00:00-03:00`).getUTCDay()) ||
    date > addDays(localDate(now), rules.horizon_days) ||
    minutes < 30 ||
    minutes > 600
  )
    return [];
  const open = Date.parse(`${date}T${rules.opens}:00-03:00`),
    close = Date.parse(`${date}T${rules.closes}:00-03:00`);
  const result: Busy[] = [];
  for (let start = open; start + minutes * 60000 <= close; start += rules.interval * 60000) {
    const hour =
      Number(rules.opens.slice(0, 2)) +
      Number(rules.opens.slice(3)) / 60 +
      (start - open) / 3600000;
    if (
      start <= now.getTime() + rules.notice_minutes * 60000 ||
      (period === 'morning' && hour >= 12) ||
      (period === 'afternoon' && hour < 12)
    )
      continue;
    const candidate = {
      starts_at: new Date(start).toISOString(),
      ends_at: new Date(start + minutes * 60000).toISOString(),
    };
    if (!busy.some((b) => overlaps(candidate, b))) result.push(candidate);
  }
  return result;
}
export const seedServices: Service[] = [
  {
    id: '20000000-0000-4000-8000-000000000001',
    shop_id: SHOP_ID,
    name: 'Lavagem detalhada',
    description: 'Limpeza minuciosa por dentro e por fora. Seu carro renovado em cada detalhe.',
    price_cents: 15000,
    duration_minutes: 90,
    active: true,
  },
  {
    id: '20000000-0000-4000-8000-000000000002',
    shop_id: SHOP_ID,
    name: 'Polimento geral',
    description: 'Recupere o brilho da pintura com correção de marcas e acabamento refinado.',
    price_cents: 65000,
    duration_minutes: 240,
    active: true,
  },
  {
    id: '20000000-0000-4000-8000-000000000003',
    shop_id: SHOP_ID,
    name: 'Higienização interna',
    description: 'Cuidado profundo com bancos, carpetes e superfícies do seu interior.',
    price_cents: 35000,
    duration_minutes: 180,
    active: true,
  },
  {
    id: '20000000-0000-4000-8000-000000000004',
    shop_id: SHOP_ID,
    name: 'Proteção de pintura',
    description: 'Uma camada de proteção para preservar o brilho e facilitar os próximos cuidados.',
    price_cents: 90000,
    duration_minutes: 360,
    active: true,
  },
];

const shortWeekdays = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];
const longWeekdays = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];
/** "seg a sáb" for a continuous Monday-first run, otherwise "seg, qua, sex". */
export function workDaysLabel(days: number[], long = false) {
  const names = long ? longWeekdays : shortWeekdays;
  const order = [1, 2, 3, 4, 5, 6, 0].filter((d) => days.includes(d));
  const positions = order.map((d) => (d + 6) % 7);
  const continuous = positions.every((p, i) => i === 0 || p === positions[i - 1] + 1);
  return continuous && order.length > 2
    ? `${names[order[0]]} a ${names[order[order.length - 1]]}`
    : order.map((d) => names[d]).join(', ');
}
