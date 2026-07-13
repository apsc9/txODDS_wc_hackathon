# FULLTIME web

Next.js (App Router) frontend for the FullTime prediction-market program —
live World Cup fixtures from TxODDS's TxLINE feed, on-chain FPMM markets on
Solana devnet, wallet-connected trading and permissionless market creation,
and Resolution Receipts that decode the actual on-chain merkle proof.

**Devnet only.** Every market, trade, and mint here lives on Solana devnet
with a throwaway test-USDC stake token — there is no real money anywhere in
this app. TxLINE credentials are devnet feed credentials, not anything
production. Do not point any of this at mainnet without a full security
review; it was built for a hackathon demo, not custody of real funds.

## Prerequisites

- Node 20+
- A TxLINE devnet API account (ask a team member, or see TxODDS's onboarding
  docs) — needed to fetch fixtures/odds/scores at all.
- A funded devnet Solana wallet (`.keys/dev-wallet.json` at the repo root —
  used by the `packages/ingest` scripts below: the TxLINE auth CLI and the
  market seeder). The web app's own server-side chain poller is read-only
  and signs nothing (it uses a throwaway generated keypair — see
  `src/server/chain.ts`), so no wallet is needed just to run the app.
  `solana airdrop` on devnet if the wallet is dry.

## 1. Environment

```
cd apps/web
cp .env.local.example .env.local
```

Fill in `.env.local`:

| Var | Where it's used | Notes |
| --- | --- | --- |
| `TXLINE_API` | server-side (`src/server/txline.ts`) | TxLINE API origin, e.g. `https://txline-dev.txodds.com` |
| `TXLINE_CREDS` | server-side | Path to a TxLINE creds JSON (`{ jwt, apiToken }`) — see step 2 |
| `NEXT_PUBLIC_RPC` | client + server | Devnet RPC URL, defaults to `https://api.devnet.solana.com` if unset |
| `NEXT_PUBLIC_EXPLORER` | client (`receipt-chain.tsx`) | Explorer base URL for receipt links, defaults to `https://explorer.solana.com` |
| `NEXT_PUBLIC_ORACLE_PROGRAM` | server (`receipt.ts`) + client (`use-create-market.ts`) | FullTime oracle program id that publishes daily score-proof roots |
| `NEXT_PUBLIC_STAKE_MINT` | client (`use-create-market.ts`) | Fallback stake-token mint for creating a market on a fixture with no markets yet — the seeder (step 3) prints this; copy it in |

`NEXT_PUBLIC_FULLTIME_PROGRAM`, bare `ORACLE_PROGRAM`, and `STAKE_MINT_PATH`
also appear in `.env.local.example` but aren't read by this app — the
FullTime program id comes from `src/idl/fulltime.json`'s baked-in `address`
field instead. `ORACLE_PROGRAM` and `STAKE_MINT_PATH` are vestigial; they are
not read via `process.env` anywhere in the repo — `packages/ingest/src/config.ts`
hardcodes the oracle PublicKey literal, and `seed-markets.ts` hardcodes the
stake-mint path as a URL constant. Setting them has no effect.

`TXLINE_CREDS`/`TXLINE_API` are server-only (no `NEXT_PUBLIC_` prefix) —
never bundled to the browser. Everything prefixed `NEXT_PUBLIC_` is public by
Next.js convention; only put devnet-safe values there.

**Never commit `.env.local` or anything under `.keys/`.**

## 2. TxLINE credentials

The web app needs a `{ jwt, apiToken }` JSON at the path `TXLINE_CREDS`
points to. Generate/refresh one with the ingest package's auth CLI:

```
cd packages/ingest
npx tsx src/auth-cli.ts devnet
```

This authenticates against TxLINE devnet using `.keys/dev-wallet.json` and
writes `.keys/txline-creds.devnet.json` (the default `TXLINE_CREDS` target in
`.env.local.example`). Re-run it if requests start failing with a
credentials error — the app surfaces that failure with this exact remedy
command (`src/server/boot.ts`'s `ensureStarted()` fails fast on a missing/
malformed creds file rather than silently serving an empty feed).

## 3. Seed devnet markets

Fixtures alone don't give you tradeable markets — run the idempotent seeder
once (safe to re-run any time; it skips markets that already exist on-chain):

```
cd packages/ingest
npx tsx src/seed-markets.ts devnet
```

This creates a persistent test stake mint at `.keys/stake-mint.json` (reused
across runs, unlike the throwaway mint `smoke-devnet.ts` uses), funds the
wallet's ATA, and creates a fixed slate of goals/corners/yellows/home-win
markets for every fixture in the current +/- fixture window. It prints the
stake mint address on first run — copy that into `NEXT_PUBLIC_STAKE_MINT` in
`.env.local`.

## 4. Recorder (optional)

Not required to run the app — only useful for capturing raw TxLINE SSE
packets for later replay/debugging:

```
cd packages/ingest
npx tsx src/recorder.ts devnet
```

Writes JSONL to `data/recordings/`, one file per stream per day, with
reconnect/backoff built in.

## 5. Run the dev server

```
cd apps/web
npm install
npm run dev
```

Open `http://localhost:3000`. Connect a devnet-funded wallet (Phantom/
Solflare, set to devnet) to trade, create markets, or claim positions —
everything else (browsing fixtures, markets, charts, receipts) works fully
read-only with no wallet connected.

## Tests / build

```
cd apps/web
npx vitest run       # unit tests — pure helpers, hooks logic, server modules
npx tsc --noEmit      # type check
npx next build        # production build
```

## Project conventions

- `src/app/` — Next.js App Router pages/routes; `src/app/api/*` are thin
  routes over the in-memory feed hub (`src/server/feedhub.ts`) and the chain
  poller (`src/server/chain.ts`), never re-implementing state themselves.
- `src/components/` — presentational + client-state components (chalk
  betting-slip look: trade slip, ticket stubs, create-market modal, receipt).
- `src/lib/` — pure, dependency-free helpers (no `"use client"`, no
  `"server-only"`) shared by both RSC pages and client components, and unit
  tested directly with Vitest.
- `src/server/` — server-only modules (`"server-only"` import guard):
  TxLINE ingest, the live feed hub, the chain poller, receipt building.
- Palette/design tokens live in `src/app/globals.css` — dark app chrome
  (`--bg`/`--surface`/`--chalk`/`--gold`) plus light "chalk paper" cards for
  the trade slip / tickets / receipt / create-market modal. Green/red
  (`--yes`/`--no`) are reserved for YES/NO outcomes only.
- This is a devnet demo, not a production betting product: settlement is by
  merkle-proof receipt, not by vote, and every "funds" figure on screen is
  test-USDC.
