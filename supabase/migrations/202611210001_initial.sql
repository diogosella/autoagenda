-- All customer operations go through the loopback Node API, using service_role.
-- Anonymous/authenticated database clients receive no access to customer records.
create extension if not exists btree_gist with schema extensions;

create table public.shops (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  timezone text not null default 'America/Sao_Paulo' check (timezone = 'America/Sao_Paulo'),
  capacity integer not null default 1 check (capacity = 1)
);
create table public.shop_members (
  shop_id uuid not null references public.shops(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  primary key (shop_id, user_id)
);
create table public.services (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references public.shops(id),
  name text not null check (char_length(name) between 3 and 80),
  description text not null default '' check (char_length(description) <= 240),
  price_cents integer not null check (price_cents between 100 and 10000000),
  duration_minutes integer not null check (duration_minutes between 30 and 600 and duration_minutes % 30 = 0),
  active boolean not null default true,
  unique (shop_id, id)
);
create table public.bookings (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references public.shops(id),
  service_id uuid not null,
  service_name text not null,
  price_cents integer not null check (price_cents >= 100),
  duration_minutes integer not null check (duration_minutes between 30 and 600 and duration_minutes % 30 = 0),
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  customer_name text not null check (char_length(customer_name) between 2 and 80),
  phone text not null check (phone ~ '^\+?[0-9 ()-]{10,20}$'),
  vehicle text not null check (char_length(vehicle) between 2 and 100),
  status text not null default 'confirmed' check (status in ('confirmed', 'completed', 'cancelled')),
  estimate_accepted_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  foreign key (shop_id, service_id) references public.services(shop_id, id),
  check (ends_at = starts_at + duration_minutes * interval '1 minute'),
  -- Half-open ranges: one car can arrive exactly when the previous car leaves.
  constraint bookings_no_overlap exclude using gist (
    shop_id with =,
    tstzrange(starts_at, ends_at, '[)') with &&
  ) where (status <> 'cancelled')
);
create index bookings_shop_start on public.bookings(shop_id, starts_at);
alter table public.shops enable row level security;
alter table public.shop_members enable row level security;
alter table public.services enable row level security;
alter table public.bookings enable row level security;
-- Intentionally no public policies. The backend authorizes the owner before queries.
revoke all on public.shops, public.shop_members, public.services, public.bookings from anon, authenticated;
grant all on public.shops, public.shop_members, public.services, public.bookings to service_role;

create function public.book_service(
  p_shop_id uuid, p_service_id uuid, p_starts_at timestamptz,
  p_customer_name text, p_phone text, p_vehicle text,
  p_expected_price integer, p_expected_duration integer
) returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  service public.services%rowtype;
  booking public.bookings%rowtype;
  local_start timestamp;
  local_end timestamp;
begin
  -- Lock the catalog row so a concurrent price/duration update cannot change the quote.
  select * into service from public.services
    where id = p_service_id and shop_id = p_shop_id and active for share;
  if not found then raise exception 'Serviço indisponível'; end if;
  if service.price_cents <> p_expected_price or service.duration_minutes <> p_expected_duration then
    raise exception 'O preço ou a duração mudou. Atualize os detalhes.';
  end if;
  local_start := p_starts_at at time zone 'America/Sao_Paulo';
  local_end := local_start + service.duration_minutes * interval '1 minute';
  if p_starts_at <= now() or local_start::date > (now() at time zone 'America/Sao_Paulo')::date + 180
    or extract(dow from local_start) = 0
    or local_start::time < time '08:00' or local_end::time > time '18:00'
    or local_start::date <> local_end::date
    or extract(minute from local_start)::integer % 30 <> 0
    or extract(second from local_start) <> 0 then
    raise exception 'Horário fora do expediente ou indisponível';
  end if;
  insert into public.bookings(shop_id, service_id, service_name, price_cents, duration_minutes,
    starts_at, ends_at, customer_name, phone, vehicle)
  values(p_shop_id, service.id, service.name, service.price_cents, service.duration_minutes,
    p_starts_at, p_starts_at + service.duration_minutes * interval '1 minute',
    trim(p_customer_name), trim(p_phone), trim(p_vehicle)) returning * into booking;
  return to_jsonb(booking);
end;
$$;
revoke all on function public.book_service(uuid, uuid, timestamptz, text, text, text, integer, integer) from public, anon, authenticated;
grant execute on function public.book_service(uuid, uuid, timestamptz, text, text, text, integer, integer) to service_role;
