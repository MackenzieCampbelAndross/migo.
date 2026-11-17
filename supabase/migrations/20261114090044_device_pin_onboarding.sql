begin;

create table if not exists public.onboarding_details (
  user_id uuid primary key references auth.users(id) on delete cascade,
  phone text not null check (phone ~ '^\+[1-9][0-9]{7,14}$'),
  phone_verified boolean not null default false check (phone_verified = false),
  updated_at timestamptz not null default now()
);

create table if not exists public.device_pins (
  device_hash text primary key check (device_hash ~ '^[a-f0-9]{64}$'),
  user_id uuid not null references auth.users(id) on delete cascade,
  pin_hash text not null,
  generation uuid not null default gen_random_uuid(),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  constraint device_pins_hash_length check (char_length(pin_hash) between 80 and 256)
);

create index if not exists device_pins_user_idx on public.device_pins (user_id);
create index if not exists device_pins_expiry_idx on public.device_pins (expires_at);

alter table public.onboarding_details enable row level security;
alter table public.device_pins enable row level security;
revoke all on public.onboarding_details, public.device_pins from public, anon, authenticated;
grant select, insert, update, delete on public.onboarding_details, public.device_pins to service_role;

-- Reads go through the PIN-gated server API, not the session-only Data API.
revoke all on public.profiles, public.wallets, public.payments, public.payment_requests,
  public.split_groups, public.escrows from anon, authenticated;
revoke select (id, user_id, address, created_at, updated_at) on public.wallets from authenticated;
revoke select (
  id, owner_user_id, owner_address, destination_user_id, destination_address,
  amount, currency, code_hash, condition_hex, escrow_issuer_address,
  escrow_sequence, status, failed_attempts, client_request_id, burn_tx_hash,
  tx_hash_create, tx_hash_finish, mint_tx_hash, claimed_by_user_id,
  split_group_id, expires_at, created_at, updated_at
) on public.escrows from authenticated;

notify pgrst, 'reload schema';
commit;
