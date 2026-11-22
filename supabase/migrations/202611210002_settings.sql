alter table public.shops add column settings jsonb not null default '{"days":[1,2,3,4,5,6],"opens":"08:00","closes":"18:00","interval":30,"notice_minutes":0,"horizon_days":180,"delivery_notice":"A previsão de entrega pode variar conforme o estado da pintura. A loja avaliará o veículo na chegada."}'::jsonb;

create or replace function public.book_service(
  p_shop_id uuid, p_service_id uuid, p_starts_at timestamptz,
  p_customer_name text, p_phone text, p_vehicle text,
  p_expected_price integer, p_expected_duration integer
) returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  service public.services%rowtype;
  booking public.bookings%rowtype;
  local_start timestamp;
  local_end timestamp;
  rules jsonb;
begin
  select settings into rules from public.shops where id=p_shop_id for share;
  -- Lock the catalog row so a concurrent price/duration update cannot change the quote.
  select * into service from public.services
    where id = p_service_id and shop_id = p_shop_id and active for share;
  if not found then raise exception 'Serviço indisponível'; end if;
  if service.price_cents <> p_expected_price or service.duration_minutes <> p_expected_duration then
    raise exception 'O preço ou a duração mudou. Atualize os detalhes.';
  end if;
  local_start := p_starts_at at time zone 'America/Sao_Paulo';
  local_end := local_start + service.duration_minutes * interval '1 minute';
  if p_starts_at <= now() + (rules->>'notice_minutes')::integer * interval '1 minute'
    or local_start::date > (now() at time zone 'America/Sao_Paulo')::date + (rules->>'horizon_days')::integer
    or not (rules->'days' @> to_jsonb(extract(dow from local_start)::integer))
    or local_start::time < (rules->>'opens')::time or local_end::time > (rules->>'closes')::time
    or local_start::date <> local_end::date
    or mod(extract(epoch from (local_start::time - (rules->>'opens')::time))::numeric, (rules->>'interval')::integer * 60) <> 0
    then
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
