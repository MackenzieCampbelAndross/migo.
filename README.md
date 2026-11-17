# Migo — Non-Custodial Cross-Border P2P Payments on XRPL

<div align="center">
  <img src="public/ambassador.png" alt="Migo Ambassador" width="120" height="120" />
  <h3>Move Money Across Borders in 3 Seconds.</h3>
  <p>Non-custodial, peer-to-peer global remittances powered by the XRP Ledger.</p>
</div>

---

## Overview

**Migo** is a modern, mobile-first fintech application built for instant cross-border remittances. By leveraging native XRP Ledger (XRPL) Automated Market Maker (AMM) orderbooks and pathfinding, Migo enables instant, direct currency swaps between **USD ($)**, **INR (₹)**, **EUR (€)**, **NGN (₦)**, and **XRP** with deterministic 3-second finality and hardware-grade security.

### Core Value Propositions
- **3-Second Finality:** Settles cross-border payments instantly over the XRPL consensus ledger.
- **Microscopic Fees:** Average network fee of `0.000012 XRP` with zero arbitrary remittance markups.
- **Non-Custodial Architecture:** Private seeds encrypted at rest using AES-256-GCM, bound to user authentication, with an independent 4-digit device security PIN.
- **Zero AI-Slop Design:** Flat, high-contrast, institutional fintech palette (solid purple, dark charcoal, stark white, and deep black) with tactile haptic-style micro-interactions.

---

## Mobile-First Architecture & Gesture Navigation

Migo is designed as a mobile web application / PWA / Capacitor container with a spatial gesture-driven interface:

1. **Center (Home Screen):**
   - Privacy-masked titanium balance card with 3 states: Masked $\rightarrow$ in-place 4-digit PIN unlock $\rightarrow$ Revealed balance.
   - Exact 3 quick actions: **Send**, **Scan**, and **Wallet**.
   - Live transaction activity feed pulled directly from the ledger.
2. **Slide Right (Wallet Details):**
   - High-contrast black & white QR code for receiving payments.
   - Truncated XRPL address chip with one-touch clipboard copy.
   - Real-time balances across all supported currencies (`USD`, `INR`, `EUR`, `NGN`, `XRP`).
3. **Slide Left (Transaction History):**
   - Comprehensive ledger transaction history with timestamps, currency conversions, and direct links to the XRPL Testnet Explorer.
4. **Top Right (Ambassador Avatar & Profile Drawer):**
   - Tapping the official pixel dinosaur ambassador opens the profile details sheet: verified email, base ledger currency, PIN security status, and sign-out.

---

## React Bits Component Integrations

The mobile application integrates custom UI components adapted from [React Bits](https://reactbits.dev) for tactile mobile interactions:

- **`<DitherVeil />` ([app/components/reactbits/DitherVeil.js](app/components/reactbits/DitherVeil.js)):**
  WebGL Floyd-Steinberg error-diffusion shader rendering an interactive dithered Earth portal on the mobile splash screen. Pointer or touch motion dissolves the dither veil into full color with a purple accent rim.
- **`<CodeSlots />` ([app/components/reactbits/CodeSlots.js](app/components/reactbits/CodeSlots.js)):**
  Animated spring-loaded input slots powering the **6-digit email OTP** verification and **4-digit device PIN** enrollment, with error cascade drains and success washes.
- **`<GlideSelect />` ([app/components/reactbits/GlideSelect.js](app/components/reactbits/GlideSelect.js)):**
  Custom select dropdown with animated gliding pills, keyboard typeahead, and viewport-adaptive placement for currency pairs and international dial codes.
- **`<SlideCommit />` ([app/components/reactbits/SlideCommit.js](app/components/reactbits/SlideCommit.js)):**
  Haptic-style slide-to-confirm payment control on the Send screen that locks into a pending spinner and verifies ledger settlement upon commit.

---

## Security Architecture

```
User (Mobile App / PWA)
  ↓
Supabase Auth (OTP Verification, PKCE)
  ↓
Server-Side Session & Ownership Guard (auth.uid())
  ↓
AES-256-GCM Seed Vault (Decrypted in memory only during authorized signing)
  ↓
XRPL AMM Liquidity Pathfinding (Client-enforced DeliverMin & Slippage Bounds)
  ↓
XRPL Ledger Consensus (tesSUCCESS)
```

- **Seed Security:** Seeds are encrypted at rest with `WALLET_ENCRYPTION_KEY` via AES-256-GCM and bound to the authenticated user ID. Seeds are never returned in responses, stored in `localStorage`, or logged.
- **Device PIN:** 4-digit PIN is salted and hashed independently to protect client-side unlocks.
- **DEX Slippage Protection:** Cross-currency payments compute minimum delivery bounds (`DeliverMin`) dynamically to prevent frontrunning or pool depletion.
- **Idempotency:** Payment endpoints enforce client idempotency keys to guarantee zero double-spends.

---

## Getting Started

### Prerequisites
- **Node.js:** v18.18+ (Node 20+ recommended)
- **Supabase Project:** Configured with Auth and Database tables
- **XRPL Testnet Access:** Connected to `wss://s.altnet.rippletest.net:51233`

### Installation
```bash
# Clone the repository
git clone https://github.com/MackenzieCampbelAndross/migo.git
cd migo

# Install dependencies
npm install
```

### Environment Configuration
Create a `.env.local` file in the root directory:
```env
# Supabase Configuration
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key

# Cryptography & Vault Key (32-byte hex)
WALLET_ENCRYPTION_KEY=your-64-character-hex-key

# XRPL Network
NEXT_PUBLIC_XRPL_WS=wss://s.altnet.rippletest.net:51233
XRPL_ISSUER_ADDRESS=your-testnet-issuer-address
XRPL_ISSUER_SEED=your-testnet-issuer-seed
```

### Development Server
```bash
npm run dev
```
Open [http://localhost:3000](http://localhost:3000) in your mobile browser or device simulator.

### Run Tests
```bash
# Run unit, security, and payment flow tests
npm test
```

### Build for Production
```bash
npm run build
```

---

## Tested Scenarios & Ledger Proofs

The test suite validates real transactions executed live on the XRPL testnet:
- **Direct USD Payment:** Hash `0AC1604FEF2602F0534889F94A09B9E8FDAC23748C6BA306E07607599A8F3C2A` (`tesSUCCESS`)
- **Cross-Currency AMM DEX Swap (USD $\rightarrow$ INR):** Hash `C61D4DE18672360B15CF6EB67A0401A55E9117C3100C2216FBEFB9682E9AEC4B` (Delivered `4.371412 INR` for `$0.05 USD` at rate `87.428240 INR/USD`)

---

## License

MIT © [Mackenzie Campbell Andross](https://github.com/MackenzieCampbelAndross)
