# Migo — Cross-Border P2P Payments on XRPL

**Testnet demo only.** No real money, no production custody, and no mainnet support.
The app is being hardened so the testnet product can keep evolving safely.

## What it does

- Email sign-in through Supabase Auth
- Testnet wallet creation (faucet-funded) or import
- Send to `@username` or an XRPL address with AMM/DEX pathfinding
- QR receive/scan
- 10-character claim codes backed by a conditional XRPL escrow trigger
- Payment requests and split payments
- Ledger-backed transaction history with expiry refunds
- Installable PWA with an offline page

## Security architecture

```
User
 ↓
Supabase Auth (email magic link, PKCE)
 ↓
Server-side session validation (getUser, never getSession)
 ↓
Authorization helpers + wallet ownership (auth.uid())
 ↓
Server-side testnet signer (AES-256-GCM encrypted seed, never returned)
 ↓
XRPL testnet
```

Key properties:

- Client-supplied wallet addresses and seeds are never used as authorization.
- Seeds are encrypted at rest with `WALLET_ENCRYPTION_KEY` and bound to the
  owning user ID with AES-GCM additional authenticated data.
- Seeds are never returned by an API, stored in browser storage, or logged.
- Issuer signing keys live only in server environment variables.
- Every sensitive API route validates Supabase identity, ownership, input, and
  rate limits.
- Supabase RLS is enabled with explicit policies; the service-role key is
  server-only.
- Payment quotes are recomputed server-side, `DeliverMin` protects against
  slippage, and idempotency keys prevent duplicate payments.
- Escrow value is a single asset: IOUs are burned from the sender and minted to
  the claimer (or back to the sender on refund). The XRPL escrow is an
  issuer-owned 1-drop conditional trigger, not a second charge.
- Claim codes are 50-bit, stored as HMAC hashes, rate-limited, and bound to the
  intended recipient when one is supplied.
- The service worker never caches `/api/*` or navigations.

### Interim custody limitation

The server-side signer is a **testnet development mechanism**, not production
custody. It is isolated in `lib/signing/server-signer.js` so it can be replaced
with Xaman/client-side signing, a hardware wallet, MPC, or KMS-backed custody
without rewriting the API or escrow services. Do not move real funds into this
system.

## Setup

### 1. Install

```bash
npm install
```

### 2. Supabase Auth

In the Supabase dashboard:

1. Enable the Email provider under Authentication → Providers.
2. Set the Site URL (for local development, `http://localhost:3000`).
3. Add `http://localhost:3000/auth/callback` to the redirect allow-list.
4. Add the production origin and `/auth/callback` before deploying.

### 3. Environment

Copy `.env.example` to `.env.local` and fill in the values. Variable names:

- `NEXT_PUBLIC_APP_URL`
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `WALLET_ENCRYPTION_KEY`
- `CLAIM_CODE_PEPPER`
- `CRON_SECRET`
- `GEMINI_API_KEY`
- `XRPL_TESTNET_URL`
- `XRPL_EXPLORER_URL`
- `XRPL_ISSUER_{USD,INR,EUR,NGN}_ADDRESS`
- `XRPL_ISSUER_{USD,INR,EUR,NGN}_SEED`

Generate local server secrets (do not commit the output):

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"  # WALLET_ENCRYPTION_KEY
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"  # CLAIM_CODE_PEPPER
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"     # CRON_SECRET
```

Changing `WALLET_ENCRYPTION_KEY` makes existing stored wallets undecryptable.
Key rotation is not implemented yet.

### 4. Database migration

Apply `supabase/migrations/0001_security_hardening.sql` in the Supabase SQL
editor or with the Supabase CLI. See `supabase/README.md`.

The migration renames the old demo tables to `legacy_*` (preserving data) and
removes client access. If the migration has not been applied, sensitive routes
fail closed with `503` because the rate-limit RPC is missing.

### 5. Fresh testnet issuers

The old committed testnet keys are compromised. Create new issuers:

```bash
npm run bootstrap
```

This writes issuer addresses and seeds to a gitignored `.env.bootstrap` file.
Merge it into `.env.local`, then delete `.env.bootstrap`. The script does not
print seed values.

### 6. Run

```bash
npm run dev
```

Open `http://localhost:3000`, sign in with email, then create or import a
testnet wallet.

### 7. Expiry/refund scheduler

Escrow refunds are processed by `GET /api/cron/expire` with a bearer secret.
Configure a scheduler (for example a GitHub Actions cron or a server cron) to
call it every few minutes:

```bash
curl -H "Authorization: Bearer $CRON_SECRET" https://your-app.example/api/cron/expire
```

The sender can also refund an expired escrow from the History screen. Refunds
require the on-chain `CancelAfter` window to pass (about three minutes after
the displayed expiry).

## Validation

```bash
npm test
npm run build
npm audit
```

## Secret history cleanup

Treat every previously committed XRPL seed as compromised. Rotate first, then
purge the file from Git history. Do not run this before committing the current
working tree because history rewriting requires a clean repository:

```bash
pip install git-filter-repo
git filter-repo --path lib/config.json --invert-paths --force
git push --force --all
git push --force --tags
```

Collaborators must re-clone after a history rewrite.

## Not included yet

- Production custody, account recovery, or key export
- Fiat on/off-ramp, KYC/AML, sanctions screening, or money-transmission licensing
- Mainnet support
- Live-market rate feeds
- Full adversarial integration tests against a deployed Supabase project
