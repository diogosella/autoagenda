import { defaultSettings, settingsSchema, type Settings } from '../shared/settings.ts';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import {
  type Booking,
  type BookingInput,
  type Service,
  slots,
  seedServices,
  localDate,
  SHOP_ID,
} from '../shared/domain.ts';

export class AppError extends Error {
  constructor(
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}
export const shopId = process.env.SHOP_ID || SHOP_ID;
const configured = [
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  process.env.SUPABASE_ANON_KEY,
];
if (configured.some(Boolean) && !configured.every(Boolean))
  throw new Error(
    'Preencha todas as variáveis SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY e SUPABASE_ANON_KEY, ou remova as três para usar a demonstração.',
  );
export const db = configured.every(Boolean)
  ? createClient(configured[0]!, configured[1]!, {
      auth: { persistSession: false, autoRefreshToken: false },
    })
  : null;
type State = { services: Service[]; bookings: Booking[]; settings?: Settings };
export class LocalStore {
  state: State;
  constructor(public path: string) {
    this.state = existsSync(path)
      ? JSON.parse(readFileSync(path, 'utf8'))
      : { services: seedServices.map((s) => ({ ...s, shop_id: shopId })), bookings: [] };
  }
  save(state: State) {
    mkdirSync(dirname(this.path), { recursive: true });
    writeFileSync(`${this.path}.tmp`, JSON.stringify(state, null, 2));
    renameSync(`${this.path}.tmp`, this.path);
    this.state = state;
  }
  book(input: BookingInput, now = new Date()): Booking {
    const service = this.state.services.find((s) => s.id === input.service_id && s.active);
    if (!service) throw new AppError('Serviço indisponível.', 404);
    if (
      service.price_cents !== input.expected_price_cents ||
      service.duration_minutes !== input.expected_duration_minutes
    )
      throw new AppError(
        'O preço ou a duração mudou. Atualize os serviços e revise os detalhes antes de confirmar.',
        409,
      );
    const busy = this.state.bookings.filter((b) => b.status !== 'cancelled');
    const slot = slots(
      localDate(new Date(input.starts_at)),
      service.duration_minutes,
      busy,
      'any',
      now,
      this.state.settings || defaultSettings,
    ).find((s) => Date.parse(s.starts_at) === Date.parse(input.starts_at));
    if (!slot)
      throw new AppError('Esse horário não está mais disponível. Escolha outro horário.', 409);
    const booking: Booking = {
      id: randomUUID(),
      shop_id: shopId,
      service_id: service.id,
      service_name: service.name,
      price_cents: service.price_cents,
      duration_minutes: service.duration_minutes,
      ...slot,
      customer_name: input.customer_name,
      phone: input.phone,
      vehicle: input.vehicle,
      status: 'confirmed',
    };
    this.save({ ...this.state, bookings: [...this.state.bookings, booking] });
    return booking;
  }
}
const local = db ? null : new LocalStore(resolve(process.env.DEMO_DATA_FILE || '.data/demo.json'));
function checked<T>(data: T, error: { message: string; code?: string } | null): T {
  if (error) {
    console.error('Database:', error.code);
    if (error.code === 'P0001')
      throw new AppError(
        'O serviço ou o horário mudou. Atualize os serviços e horários antes de confirmar.',
        409,
      );
    throw new AppError(
      error.code === '23P01'
        ? 'Esse horário acabou de ser reservado. Escolha outro.'
        : 'Não foi possível concluir a operação no banco.',
      error.code === '23P01' ? 409 : 400,
    );
  }
  return data;
}
export async function getServices() {
  if (local) return local.state.services;
  const { data, error } = await db!
    .from('services')
    .select('*')
    .eq('shop_id', shopId)
    .order('name');
  return checked(data as Service[], error);
}
export async function getBookings() {
  if (local) return local.state.bookings;
  const { data, error } = await db!
    .from('bookings')
    .select('*')
    .eq('shop_id', shopId)
    .order('starts_at');
  return checked(data as Booking[], error);
}
export async function createBooking(input: BookingInput) {
  if (local) return local.book(input);
  const { data, error } = await db!.rpc('book_service', {
    p_shop_id: shopId,
    p_service_id: input.service_id,
    p_starts_at: input.starts_at,
    p_customer_name: input.customer_name,
    p_phone: input.phone,
    p_vehicle: input.vehicle,
    p_expected_price: input.expected_price_cents,
    p_expected_duration: input.expected_duration_minutes,
  });
  return checked(data as Booking, error);
}
export async function saveService(service: Omit<Service, 'shop_id'>) {
  if (local) {
    const old = local.state.services.filter((s) => s.id !== service.id);
    local.save({ ...local.state, services: [...old, { ...service, shop_id: shopId }] });
    return;
  }
  const { error } = await db!
    .from('services')
    .upsert({ ...service, shop_id: shopId }, { onConflict: 'id' });
  checked(null, error);
}
export async function changeStatus(id: string, status: Booking['status']) {
  const bookings = await getBookings();
  const booking = bookings.find((b) => b.id === id);
  if (!booking) throw new AppError('Agendamento não encontrado.', 404);
  if (booking.status !== 'confirmed')
    throw new AppError('Esse agendamento já foi finalizado.', 409);
  if (local) {
    local.save({
      ...local.state,
      bookings: bookings.map((b) => (b.id === id ? { ...b, status } : b)),
    });
    return;
  }
  const { data, error } = await db!
    .from('bookings')
    .update({ status })
    .eq('id', id)
    .eq('shop_id', shopId)
    .eq('status', 'confirmed')
    .select('id');
  checked(null, error);
  if (!data?.length) throw new AppError('Esse agendamento já foi finalizado.', 409);
}

export async function getSettings(): Promise<Settings> {
  if (local) return { ...defaultSettings, ...local.state.settings };
  const { data, error } = await db!.from('shops').select('settings').eq('id', shopId).single();
  checked(null, error);
  return settingsSchema.parse(data?.settings);
}
export async function saveSettings(settings: Settings) {
  if (local) {
    local.save({ ...local.state, settings });
    return;
  }
  const { error } = await db!.from('shops').update({ settings }).eq('id', shopId);
  checked(null, error);
}
