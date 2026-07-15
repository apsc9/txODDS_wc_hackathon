# FullTime + Touchline

A settlement-first prediction market for World Cup outcomes, plus an autonomous agent that keeps it liquid and honest. Built on Solana devnet with the [TxLINE](https://txline.txodds.com) World Cup feed as the oracle.

Two hackathon tracks, one codebase:

- **FullTime (Track 1)** — a prediction market where any match outcome (1X2, total goals, parametric props like "combined corners > 10") becomes a market with USDC escrowed in a neutral PDA. Resolution is **permissionless**: after full-time, anyone fetches the TxLINE proof and calls `resolve`, which CPIs into TxLINE's `validate_stat` to verify the stat on-chain. No admin key decides an outcome. Every settlement produces a **Resolution Receipt** — the full proof chain (data packet → Merkle proof → on-chain validation tx) shown in the UI.
- **Touchline (Track 2)** — an autonomous keeper + market maker. It streams consensus odds, converts them to de-vigged fair probabilities, trades against the pools whenever pool price diverges from fair beyond a threshold (earning the spread, keeping displayed odds honest), and acts as the resolution keeper at full-time. Every decision is logged with its expected edge.

The closed loop: **goal on TV → feed event → agent reprices in seconds → full-time → proof verified on-chain → funds routed** — untouched by human hands.

## How settlement works (the moat)

Markets never depend on anyone's goodwill to settle:

- **Permissionless resolve** — anyone submits the TxLINE Merkle proof; the program re-verifies it on-chain via CPI into `validate_stat`. The proof is recomputed off-chain first (recompute the root from the packet before submitting).
- **Void-and-refund** — if no valid proof lands by a per-market deadline (abandoned match, data outage, or an outcome that can't be proven — see Limitations), the market voids and every holder reclaims cost basis pro-rata via `claim`. No funds ever stuck, no admin rescue key.
- **Trading closes at the resolve window** — buys are rejected once a market reaches its `resolve_after_ts`, so nobody can snipe a known result before settlement.

## Architecture

```
programs/fulltime/     Anchor program: markets, FPMM pools, resolve (CPI to TxLINE), void, claim
packages/ingest/       TxLINE auth, SSE recorder/replay, market seeder, resolution keeper
packages/agent/        Touchline: fair-price engine, trader, keeper scheduler, decision log + P&L report
apps/web/              Next.js UI: markets, trade slip, price chart, Resolution Receipt viewer
data/                  recorded feed captures + agent decision log (gitignored)
```

The agent reads market state (pool price + consensus fair) from the web app's API and sends transactions straight to the program, so it runs as a separate process alongside the UI.

## Quick start

**Prerequisites:** Node 20+, a Solana devnet RPC, an Anchor/Solana toolchain (only if rebuilding the program). The program is already deployed to devnet (`2MzYe6Zo4AD2fuszYou7CcnVmo7cdq4WjKi8UERL652L`).

**1. RPC.** The public `api.devnet.solana.com` is heavily rate-limited. Put a keyed devnet RPC in a gitignored `.env` at the repo root:

```
DEVNET_RPC=https://your-devnet-rpc-endpoint
```

`packages/ingest` and `packages/agent` read `process.env.DEVNET_RPC` (falling back to the public endpoint). Since the TS runner has no dotenv, source it before running:

```bash
set -a; source .env; set +a
```

**2. Web app.** Copy `apps/web/.env.local.example` → `apps/web/.env.local` and fill it in, then:

```bash
cd apps/web
npm install
npm run dev          # http://localhost:3000
```

**3. Touchline agent.** (Web app must be running — it's the agent's data source.)

```bash
cd packages/agent
npm install
set -a; source ../../.env; set +a

npm run setup-wallet                         # one-time: fund a fresh agent wallet with SOL + test-USDC
npm run agent -- --fixtures <fixtureId>      # DRY-RUN (default): logs would-be trades, sends nothing
npm run agent -- --live --fixtures <fixtureId>   # LIVE: trades + resolves
npm run report                               # P&L table from on-chain positions × current pool prices
```

Dry-run is the default; live trading requires the explicit `--live` flag. Risk is bounded by caps (default 5 USDC/trade, 20/market, 100 global) and a 5-point edge threshold. In `--live` the agent also auto-resolves any fixture past its resolve window every 2 minutes.

**4. Keeper (standalone).** The resolution keeper is also runnable directly:

```bash
cd packages/ingest
set -a; source ../../.env; set +a
npx tsx src/resolve-markets.ts <fixtureId>          # resolve: fetch proofs, submit on-chain
npx tsx src/resolve-markets.ts <fixtureId> --void   # void: settle markets past their void deadline
```

## Touchline decision log

Every tick appends to `data/agent/decisions.jsonl`: timestamp, market, consensus fair vs pool price, computed edge, action, size, quoted shares, tx, and resolutions. `npm run report` marks open positions to the current pool, resolved positions to their outcome, and voided positions to cost basis, and prints total P&L. The agent doesn't win every market — it wins on expected value across the book; the log is the audit trail behind that claim.

## Known limitations

- **Zero-stat outcomes can't be resolved by proof.** TxLINE's `validate_stat` rejects a stat whose value is 0 (`StatNotZero`), so any outcome whose truth requires exhibiting a zero — a team scoring 0 goals, a clean sheet, "over 0.5" settling NO after 0-0 — can't be settled by inclusion proof. Those markets settle through the void-and-refund path instead. See [docs/txline-feedback.md](docs/txline-feedback.md).
- **Consensus fair exists only for goals-derived markets.** The feed carries 1X2 / Asian-handicap / over-under odds, so the agent only prices and trades goals markets; corners/cards markets have no fair reference and are left alone (correctly).
- **The agent needs the web app running** — it's the protocol's data layer. A demo runs both processes.
- **`GameState` is unreliable on the devnet feed** — it reports `"scheduled"` through an entire live match, so live/finished classification is inferred from recent score packets rather than trusted from the field. See [docs/txline-feedback.md](docs/txline-feedback.md).
- **Devnet only** — the TxLINE devnet feed is delayed (service level 1, ~60s); real-time settlement targets the mainnet free World Cup tier.

## Feedback to TxODDS

TxLINE is the oracle this is built on, and API feedback is a required submission field. Our running log — what worked, what caused friction, and settlement-semantics findings from live matches — is in [docs/txline-feedback.md](docs/txline-feedback.md).
