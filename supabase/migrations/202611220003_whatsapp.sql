-- Conversas do WhatsApp por telefone do cliente (histórico e etapa da reserva).
create table if not exists public.whatsapp_conversations (
  shop_id uuid not null references public.shops(id) on delete cascade,
  phone text not null check (phone ~ '^[0-9]{10,15}$'),
  history jsonb not null default '[]'::jsonb,
  state jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  primary key (shop_id, phone)
);

-- Só a API (service_role) acessa; nenhum acesso direto para anon/authenticated.
alter table public.whatsapp_conversations enable row level security;
revoke all on public.whatsapp_conversations from anon, authenticated;
