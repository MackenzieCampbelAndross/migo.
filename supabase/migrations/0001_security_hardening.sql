-- Xenmo security hardening migration
-- Apply in the Supabase SQL editor or with `supabase db push`.
-- This migration is intentionally non-destructive to legacy demo data:
-- old tables are renamed to legacy_* and made inaccessible to clients.

begin;

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- Legacy tables: preserve data, remove client access
-- ---------------------------------------------------------------------------

do $$
begin
  if exists (
    select 1 from information_schema.tables
    where table_schema = 'public' and table_name = 'users'
  ) and not exists (
    select 1 from information_schema.tables
    where table_schema = 'public' and table_name = 'legacy_users'
  ) then
    execute 'alter table public.users rename to legacy_users';
  end if;

  if exists (
    select 1 from information_schema.tables
    where table_schema = 'public' and table_name = 'payment_requests'
  ) and not exists (
    select 1 from information_schema.tables
    where table_schema = 'public' and table_name = 'legacy_payment_requests'
  ) then
    execute 'alter table public.payment_requests rename to legacy_payment_requests';
  end if;

  if exists (
    select 1 from information_schema.tables
    where table_schema = 'public' and table_name = 'escrow_codes'
  ) and not exists (
    select 1 from information_schema.tables
    where table_schema = 'public' and table_name = 'legacy_escrow_codes'
  ) then
    execute 'alter table public.escrow_codes rename to legacy_escrow_codes';
  end if;
end $$;

do $$
declare
  tbl text;
begin
  foreach tbl in array array['legacy_users', 'legacy_payment_requests', 'legacy_escrow_codes']
  loop
    if exists (
      select 1 from information_schema.tables t
      where t.table_schema = 'public' and t.table_name = tbl
    ) then
      execute format('alter table public.%I enable row level security', tbl);
      execute format('revoke all on table public.%I from anon, authenticated', tbl);
    end if;
  end loop;
end $$;

-- Remove legacy plaintext signing and claim secrets. The old testnet keys are
-- compromised and the hardened app does not use the legacy tables.
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'legacy_users' and column_name = 'wallet_seed'
  ) then
    execute 'update public.legacy_users set wallet_seed = null';
    execute 'alter table public.legacy_users drop column wallet_seed';
  end if;

  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'legacy_escrow_codes' and column_name = 'human_code'
  ) then
    execute 'update public.legacy_escrow_codes set human_code = null';
    execute 'alter table public.legacy_escrow_codes drop column human_code';
  end if;

  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'legacy_escrow_codes' and column_name = 'fulfillment_hex'
  ) then
    execute 'update public.legacy_escrow_codes set fulfillment_hex = null';
    execute 'alter table public.legacy_escrow_codes drop column fulfillment_hex';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Profiles: one row per Supabase Auth user
-- ---------------------------------------------------------------------------

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username text not null unique,
  display_name text not null default '',
  base_currency text not null default 'USD',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint profiles_username_format check (
    username = lower(username) and username ~ '^[a-z0-9_]{3,20}$'
  ),
  constraint profiles_username_reserved check (
    username <> all (array[
      'admin','administrator','root','system','support','help','official',
      'migo','xenmo','remitx','wallet','pay','payment','payments','claim',
      'claims','login','signin','signup','register','api','www','app',
      'security','team','staff','service','bank','escrow','split','send',
      'receive','test','demo','guest','anonymous'
    ])
  ),
  constraint profiles_display_name_length check (char_length(display_name) <= 50),
  constraint profiles_display_name_controls check (display_name !~ '[[:cntrl:]]'),
  constraint profiles_currency check (base_currency in ('USD','INR','EUR','NGN'))
);

-- ---------------------------------------------------------------------------
-- Wallets: auth user -> XRPL address. Seeds are encrypted by the server.
-- ---------------------------------------------------------------------------

create table if not exists public.wallets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references auth.users(id) on delete cascade,
  address text not null unique,
  encrypted_seed text not null,
  key_version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint wallets_address_length check (char_length(address) between 25 and 35),
  constraint wallets_seed_length check (char_length(encrypted_seed) between 40 and 4096),
  constraint wallets_key_version check (key_version >= 1)
);

-- ---------------------------------------------------------------------------
-- Split groups
-- ---------------------------------------------------------------------------

create table if not exists public.split_groups (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null references auth.users(id) on delete cascade,
  idempotency_key text not null,
  currency text not null,
  total_amount numeric(24,6) not null,
  status text not null default 'CREATING',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint split_groups_owner_key unique (owner_user_id, idempotency_key),
  constraint split_groups_amount check (total_amount > 0 and total_amount <= 1000000000),
  constraint split_groups_currency check (currency in ('USD','INR','EUR','NGN')),
  constraint split_groups_status check (status in ('CREATING','ACTIVE','PARTIAL','FAILED'))
);

-- ---------------------------------------------------------------------------
-- Escrows: one IOU value asset plus an issuer-owned 1-drop trigger escrow
-- ---------------------------------------------------------------------------

create table if not exists public.escrows (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null references auth.users(id) on delete cascade,
  owner_address text not null,
  destination_user_id uuid references auth.users(id) on delete set null,
  destination_address text,
  amount numeric(24,6) not null,
  currency text not null,
  code_hash text not null unique,
  code_encrypted text not null,
  condition_hex text not null,
  escrow_issuer_address text not null,
  escrow_sequence bigint,
  status text not null default 'CREATING',
  failed_attempts integer not null default 0,
  client_request_id text not null,
  burn_tx_hash text,
  tx_hash_create text,
  tx_hash_finish text,
  mint_tx_hash text,
  claimed_by_user_id uuid references auth.users(id) on delete set null,
  split_group_id uuid references public.split_groups(id) on delete set null,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint escrows_owner_request unique (owner_user_id, client_request_id),
  constraint escrows_issuer_sequence unique (escrow_issuer_address, escrow_sequence),
  constraint escrows_amount check (amount > 0 and amount <= 1000000000),
  constraint escrows_currency check (currency in ('USD','INR','EUR','NGN')),
  constraint escrows_status check (
    status in ('CREATING','LOCKED','CLAIMING','CLAIMED','EXPIRED','REFUNDING','REFUNDED','FAILED')
  ),
  constraint escrows_code_hash check (char_length(code_hash) = 64),
  constraint escrows_code_encrypted check (char_length(code_encrypted) between 40 and 4096),
  constraint escrows_condition check (char_length(condition_hex) >= 40),
  constraint escrows_failed_attempts check (failed_attempts >= 0),
  constraint escrows_owner_address check (char_length(owner_address) between 25 and 35),
  constraint escrows_issuer_address check (char_length(escrow_issuer_address) between 25 and 35),
  constraint escrows_destination check (
    destination_address is null or char_length(destination_address) between 25 and 35
  ),
  constraint escrows_expiry check (expires_at > created_at)
);

-- ---------------------------------------------------------------------------
-- Payment state tracking
-- ---------------------------------------------------------------------------

create table if not exists public.payments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  idempotency_key text not null,
  dest_address text not null,
  amount numeric(24,6) not null,
  currency text not null,
  send_max_currency text not null,
  send_amount numeric(24,6) not null,
  quoted_receive numeric(24,6) not null,
  min_received numeric(24,6) not null,
  delivered_amount numeric(24,6),
  actual_sent_amount numeric(24,6),
  effective_rate numeric(24,10),
  fee_display text,
  status text not null default 'CREATED',
  tx_hash text unique,
  result_code text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint payments_user_key unique (user_id, idempotency_key),
  constraint payments_amount check (amount > 0 and amount <= 1000000000),
  constraint payments_send_amount check (send_amount > 0 and send_amount <= 1000000000),
  constraint payments_quoted check (quoted_receive > 0 and min_received > 0),
  constraint payments_min check (min_received <= quoted_receive),
  constraint payments_currency check (currency in ('USD','INR','EUR','NGN')),
  constraint payments_send_currency check (send_max_currency in ('USD','INR','EUR','NGN')),
  constraint payments_status check (status in ('CREATED','AUTHORIZED','SUBMITTED','CONFIRMED','FAILED')),
  constraint payments_destination check (char_length(dest_address) between 25 and 35)
);

-- ---------------------------------------------------------------------------
-- Payment requests
-- ---------------------------------------------------------------------------

create table if not exists public.payment_requests (
  id uuid primary key default gen_random_uuid(),
  requester_id uuid not null references auth.users(id) on delete cascade,
  payer_id uuid not null references auth.users(id) on delete cascade,
  amount numeric(24,6) not null,
  currency text not null,
  status text not null default 'PENDING',
  attempts integer not null default 0,
  tx_hash text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint payment_requests_distinct check (requester_id <> payer_id),
  constraint payment_requests_amount check (amount > 0 and amount <= 1000000000),
  constraint payment_requests_currency check (currency in ('USD','INR','EUR','NGN')),
  constraint payment_requests_status check (
    status in ('PENDING','APPROVING','APPROVED','DECLINED','FAILED','CANCELLED')
  ),
  constraint payment_requests_attempts check (attempts >= 0)
);

-- ---------------------------------------------------------------------------
-- Rate limits (server-only table)
-- ---------------------------------------------------------------------------

create table if not exists public.rate_limits (
  rate_key text primary key,
  window_start timestamptz not null default now(),
  count integer not null default 0,
  constraint rate_limits_key_length check (char_length(rate_key) between 1 and 200),
  constraint rate_limits_count check (count >= 0)
);

-- ---------------------------------------------------------------------------
-- Indexes
-- ---------------------------------------------------------------------------

create index if not exists wallets_address_idx on public.wallets (address);
create index if not exists payments_user_created_idx on public.payments (user_id, created_at desc);
create index if not exists payments_status_idx on public.payments (status);
create index if not exists escrows_owner_created_idx on public.escrows (owner_user_id, created_at desc);
create index if not exists escrows_destination_status_idx on public.escrows (destination_user_id, status);
create index if not exists escrows_expiry_idx on public.escrows (status, expires_at);
create index if not exists escrows_split_group_idx on public.escrows (split_group_id);
create index if not exists payment_requests_payer_idx on public.payment_requests (payer_id, status);
create index if not exists payment_requests_requester_idx on public.payment_requests (requester_id, created_at desc);
create index if not exists split_groups_owner_idx on public.split_groups (owner_user_id, created_at desc);
create index if not exists rate_limits_window_idx on public.rate_limits (window_start);

-- ---------------------------------------------------------------------------
-- updated_at triggers
-- ---------------------------------------------------------------------------

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists profiles_set_updated_at on public.profiles;
create trigger profiles_set_updated_at before update on public.profiles
for each row execute function public.set_updated_at();

drop trigger if exists wallets_set_updated_at on public.wallets;
create trigger wallets_set_updated_at before update on public.wallets
for each row execute function public.set_updated_at();

drop trigger if exists payments_set_updated_at on public.payments;
create trigger payments_set_updated_at before update on public.payments
for each row execute function public.set_updated_at();

drop trigger if exists escrows_set_updated_at on public.escrows;
create trigger escrows_set_updated_at before update on public.escrows
for each row execute function public.set_updated_at();

drop trigger if exists payment_requests_set_updated_at on public.payment_requests;
create trigger payment_requests_set_updated_at before update on public.payment_requests
for each row execute function public.set_updated_at();

drop trigger if exists split_groups_set_updated_at on public.split_groups;
create trigger split_groups_set_updated_at before update on public.split_groups
for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------

alter table public.profiles enable row level security;
alter table public.wallets enable row level security;
alter table public.payments enable row level security;
alter table public.escrows enable row level security;
alter table public.payment_requests enable row level security;
alter table public.split_groups enable row level security;
alter table public.rate_limits enable row level security;

revoke all on public.profiles from anon, authenticated;
revoke all on public.wallets from anon, authenticated;
revoke all on public.payments from anon, authenticated;
revoke all on public.escrows from anon, authenticated;
revoke all on public.payment_requests from anon, authenticated;
revoke all on public.split_groups from anon, authenticated;
revoke all on public.rate_limits from anon, authenticated;

grant select on public.profiles to authenticated;
grant select on public.payments to authenticated;
grant select on public.payment_requests to authenticated;
grant select on public.split_groups to authenticated;

-- encrypted_seed is intentionally excluded from the column grant.
grant select (id, user_id, address, created_at, updated_at) on public.wallets to authenticated;

-- code_encrypted is intentionally excluded from the column grant.
grant select (
  id, owner_user_id, owner_address, destination_user_id, destination_address,
  amount, currency, code_hash, condition_hex, escrow_issuer_address,
  escrow_sequence, status, failed_attempts, client_request_id, burn_tx_hash,
  tx_hash_create, tx_hash_finish, mint_tx_hash, claimed_by_user_id,
  split_group_id, expires_at, created_at, updated_at
) on public.escrows to authenticated;

drop policy if exists profiles_select_own on public.profiles;
create policy profiles_select_own on public.profiles
for select to authenticated
using (id = auth.uid());

drop policy if exists wallets_select_own on public.wallets;
create policy wallets_select_own on public.wallets
for select to authenticated
using (user_id = auth.uid());

drop policy if exists payments_select_own on public.payments;
create policy payments_select_own on public.payments
for select to authenticated
using (user_id = auth.uid());

drop policy if exists escrows_select_participant on public.escrows;
create policy escrows_select_participant on public.escrows
for select to authenticated
using (
  owner_user_id = auth.uid()
  or destination_user_id = auth.uid()
  or claimed_by_user_id = auth.uid()
);

drop policy if exists payment_requests_select_participant on public.payment_requests;
create policy payment_requests_select_participant on public.payment_requests
for select to authenticated
using (requester_id = auth.uid() or payer_id = auth.uid());

drop policy if exists split_groups_select_own on public.split_groups;
create policy split_groups_select_own on public.split_groups
for select to authenticated
using (owner_user_id = auth.uid());

-- rate_limits has RLS enabled and no policies: only service_role can access it.

-- ---------------------------------------------------------------------------
-- Atomic rate limiter (server-only RPC)
-- ---------------------------------------------------------------------------

create or replace function public.check_rate_limit(
  p_key text,
  p_limit integer,
  p_window_seconds integer
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_count integer;
begin
  if p_key is null or char_length(p_key) < 1 or p_limit is null or p_limit < 1
     or p_window_seconds is null or p_window_seconds < 1 then
    return false;
  end if;

  insert into public.rate_limits (rate_key, window_start, count)
  values (p_key, now(), 1)
  on conflict (rate_key) do update
  set count = case
        when public.rate_limits.window_start < now() - make_interval(secs => p_window_seconds)
          then 1
        else public.rate_limits.count + 1
      end,
      window_start = case
        when public.rate_limits.window_start < now() - make_interval(secs => p_window_seconds)
          then now()
        else public.rate_limits.window_start
      end
  returning count into v_count;

  return v_count <= p_limit;
end;
$$;

revoke all on function public.check_rate_limit(text, integer, integer) from public, anon, authenticated;
grant execute on function public.check_rate_limit(text, integer, integer) to service_role;

-- RLS verification matrix (conceptual):
--   User A -> profiles/wallet/payments/requests/escrows where auth.uid() = A: allowed.
--   User A -> User B rows: no rows returned (RLS using clause).
--   Unauthenticated -> new tables: no grants, no policies: denied.
--   Service role -> server operations: bypasses RLS by design.
--
-- Legacy tables are RLS-enabled with no policies and no client grants.
-- Drop them after confirming the demo data is no longer needed.

notify pgrst, 'reload schema';

commit;
