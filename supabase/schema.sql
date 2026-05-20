-- MeshParse schema
-- Run this once in the Supabase SQL Editor: https://supabase.com/dashboard/project/ajyrrxrxcywooyrahioi/sql/new

-- API keys (one per user, written by webhook on payment)
create table if not exists public.api_keys (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users(id) on delete cascade,
  api_key      text not null unique,
  active       boolean not null default true,
  created_at   timestamptz not null default now()
);

-- Subscriptions (managed by Paystack webhook)
create table if not exists public.subscriptions (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null references auth.users(id) on delete cascade,
  subscription_code text not null unique,
  customer_code     text,
  status            text not null default 'inactive',
  updated_at        timestamptz not null default now()
);

-- RLS: users can only read their own rows
alter table public.api_keys      enable row level security;
alter table public.subscriptions enable row level security;

create policy "own keys"         on public.api_keys      for select using (auth.uid() = user_id);
create policy "own subscription" on public.subscriptions for select using (auth.uid() = user_id);
-- Service role bypasses RLS automatically (used by webhook)

-- Index for fast key lookups by user
create index if not exists api_keys_user_id_idx      on public.api_keys(user_id);
create index if not exists subscriptions_user_id_idx on public.subscriptions(user_id);
