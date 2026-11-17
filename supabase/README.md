# Database setup

Apply `migrations/0001_security_hardening.sql` with the Supabase SQL editor or:

```bash
supabase db push
```

The migration:

- renames the old demo tables to `legacy_*` and removes client access
- drops legacy plaintext `wallet_seed`, `human_code`, and `fulfillment_hex` columns
- creates `profiles`, `wallets`, `payments`, `payment_requests`, `escrows`, `split_groups`, `rate_limits`
- adds indexes, state constraints, triggers, and RLS policies
- adds `check_rate_limit(...)`, executable only by `service_role`

After applying the migration you may run `VACUUM FULL public.legacy_users,
public.legacy_escrow_codes;` if you want PostgreSQL to rewrite the old table
storage as well. The old testnet keys must still be treated as compromised and
rotated.

## Why wallets are server-managed

This testnet build uses an interim server-side signer so the existing payment and
escrow flows keep working. Wallet seeds are encrypted with AES-256-GCM using
`WALLET_ENCRYPTION_KEY` and bound to the owning Supabase user ID. They are never
returned to the browser, never stored in browser storage, and never logged.

This is **not production custody**. The signing layer is isolated in
`lib/signing/server-signer.js` so it can be replaced by client-side signing,
Xaman, a hardware wallet, MPC, or KMS-backed custody without rewriting the API
or escrow services.

## RLS checks to run in the Supabase SQL editor

Replace the UUIDs with real `auth.users` IDs:

```sql
-- As user A (use the authenticated role / a user JWT):
select * from profiles where id = '<user-a>';
select * from profiles where id = '<user-b>';       -- expect 0 rows
select * from wallets;                                -- expect only A's wallet
select * from payments where user_id = '<user-b>';    -- expect 0 rows
select encrypted_seed from wallets;                    -- expect permission denied
```

Anon-key requests should receive no rows from any new table.
