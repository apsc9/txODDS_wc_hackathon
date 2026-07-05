# TxLINE Integration Notes (Phase 0 findings, 2026-07-03)

## Networks

| | Mainnet | Devnet |
|---|---|---|
| API origin | `https://txline.txodds.com` | `https://txline-dev.txodds.com` |
| Program | `9ExbZjAapQww1vfcisDmrngPinHTEfpjYRWMunJgcKaA` | `6pW64gN1s2uqjHkn1unFeEjAwJkPGHoppGvS715wyP2J` |
| TxL mint (Token-2022) | `Zhw9TVKp68a1QrftncMSd6ELXKDtpVMNuMGr1jNwdeL` | `4Zao8ocPhmMgq7PdsYWyxvqySMGx7xb9cMftPMkEokRG` |
| Free World Cup tiers | level 1 (60s delay), **level 12 (real-time)** | level 1 (60s delay) only |

Everything must stay on one network per credential set: RPC, program, guest JWT host, activation host.

## Auth flow

1. `POST {origin}/auth/guest/start` → `{ token: jwt }` (no auth needed)
2. On-chain `subscribe(service_level_id: u16, weeks: u8)` — free tiers pay nothing but still need the tx. Accounts: user (signer), `pricing_matrix` PDA (`["pricing_matrix"]`), TxL mint, user TxL ATA (Token-2022), treasury vault ATA of `token_treasury_v2` PDA, token program = Token-2022.
3. Sign `${txSig}:${leagues.join(",")}:${jwt}` (ed25519, base64) → `POST {origin}/api/token/activate` `{txSig, walletSignature, leagues}` with `Authorization: Bearer ${jwt}`
4. All data calls: `Authorization: Bearer ${jwt}` **and** `X-Api-Token: ${apiToken}`

## Data API surface (from OpenAPI)

- `GET /api/fixtures/snapshot` · `/api/fixtures/updates/{epochDay}/{hourOfDay}` · `/api/fixtures/validation` · `/api/fixtures/batch-validation`
- `GET /api/odds/snapshot/{fixtureId}` · `/api/odds/updates/{fixtureId}` · `/api/odds/updates/{epochDay}/{hourOfDay}/{interval}` · `/api/odds/stream` (SSE) · `/api/odds/validation`
- `GET /api/scores/snapshot/{fixtureId}?asOf=` · `/api/scores/updates/{fixtureId}` · `/api/scores/updates/{epochDay}/{hourOfDay}/{interval}` · `/api/scores/historical/{fixtureId}` (start 2w–6h in past) · `/api/scores/stream` (SSE) · `/api/scores/stat-validation`
- No rate limits (per docs FAQ). SSE supports gzip (`Accept-Encoding: gzip`, decompress chunks manually).
- epochDay = `floor(unixMs / 86400000)`; interval = 5-minute bucket = `floor(minutes / 5)`.

## Settlement path (`validate_stat`)

- Fetch proof: `GET /api/scores/stat-validation?fixtureId&seq&statKey[&statKey2]`
- Response fields: `summary { fixtureId, updateStats { updateCount, minTimestamp, maxTimestamp }, eventStatsSubTreeRoot }`, `subTreeProof[]`, `mainTreeProof[]`, `statToProve`, `eventStatRoot`, `statProof[]` (+ `statToProve2`, `statProof2`).
- On-chain account: `daily_scores_roots` PDA = `["daily_scores_roots", epochDay as u16 LE]` where epochDay from `summary.updateStats.minTimestamp`.
- Instruction: `validate_stat(ts: i64, fixture_summary: ScoresBatchSummary, fixture_proof: Vec<ProofNode>, main_tree_proof: Vec<ProofNode>, predicate: TraderPredicate, stat_a: StatTerm, stat_b: Option<StatTerm>, op: Option<BinaryExpression>) -> bool`
- Predicate: `(stat_a [Add|Subtract stat_b]) {GreaterThan|LessThan|EqualTo} threshold(i32)`
- Docs example sets compute budget 1,400,000 CU. **Open item: measure real CU cost — determines headroom for our CPI wrapper.**
- ProofNode = `{ hash: [u8;32], is_right_sibling: bool }`. Hashes arrive as base64 or 0x-hex strings.

## TxLINE program also ships (devnet IDL)

Full P2P trading system: `create_intent`/`execute_match` (intent + solver matching), `create_trade`/`settle_trade` (direct 2-party escrow), `settle_matched_trade`, `claim_via_resolution` (resolution-root claims), `request_devnet_faucet` (**mints test USDT to caller — use as our stake currency on devnet**), `purchase_subscription_token_usdt`. Positioning: FullTime = pooled LMSR liquidity layer — complements their P2P escrow (which needs a matched counterparty per trade), same `validate_stat` settlement primitive.

## Verified live (2026-07-03, devnet)

- Auth flow works end-to-end. Gotcha: `subscribe` requires the user's TxL ATA (Token-2022) to already exist even on free tier (`AccountNotInitialized` 3012 otherwise) — prepend `createAssociatedTokenAccountIdempotentInstruction`.
- **`validate_stat` spike: PASSED.** Real proof from `/api/scores/stat-validation` verified on-chain via `.view()` → `true`. **CU consumed: ~199K** (docs suggest 1.4M budget; actual is 7× smaller) ⇒ ample headroom to CPI from our resolve instruction in one tx. Sample payload: `data/spike-validation-sample.json`.
- `daily_scores_roots` PDA derivation confirmed (`["daily_scores_roots", epochDay u16 LE]`).
- Fixture schema (PascalCase): `{Ts, StartTime, Competition, CompetitionId, FixtureGroupId, Participant1Id, Participant1, Participant2Id, Participant2, FixtureId, Participant1IsHome}`.
- Score update schema: adds `{GameState, Action (e.g. "safe_possession"), Id, Seq, StatusId, Type, ConnectionId, CoverageType}` — event-level granularity.
- Odds stream schema: `{FixtureId, MessageId, Ts, Bookmaker, BookmakerId, SuperOddsType (e.g. OVERUNDER_PARTICIPANT_GOALS, ASIANHANDICAP_PARTICIPANT_GOALS), GameState, InRunning, MarketParameters ("line=2.5"), PriceNames, Prices (milli-decimal odds, 1622 = 1.622), Pct (implied probabilities)}`.
- **`Bookmaker: "TXLineStablePriceDemargined"` provides de-vigged prices with `Pct` fields directly** — the agent's fair-probability input needs no de-vig math of its own.
- SSE event ids look like `{intervalStartMs}:{seq}`.

## Verified live (2026-07-05, devnet) — deployed program end-to-end

- **FullTime deployed** at `2MzYe6Zo4AD2fuszYou7CcnVmo7cdq4WjKi8UERL652L` (upgrade authority = dev wallet). Gotcha fixed on the way: scaffold `declare_id!` didn't match the deploy keypair → every ix would fail `DeclaredProgramIdMismatch`; keep `target/deploy/fulltime-keypair.json` = `.keys/fulltime-program.json`.
- **Full loop verified on devnet with a fresh API proof** (`packages/ingest/src/smoke-devnet.ts`): create_market → buy YES → resolve (CPI into real oracle, ResolvedYes) → claim → withdraw_liquidity; vault drained to exactly 0.
- **Zero-valued stats are NOT provable**: oracle rejects `value: 0` proofs with `StatNotZero` (6074) during "R2 validation", even though the API serves them. Consequences for market design:
  - Predicates that need a zero stat exhibited (clean sheet, "over X" resolving NO on 0-0) can't settle directly → void/timeout fallback is the safety net (already built).
  - Prefer predicates likely to have nonzero stats at FT; keepers should check `statToProve.value > 0` before attempting resolve.

## Soccer encodings (for resolution rules)

- Game phases: 1 NS, 2 H1, 3 HT, 4 H2, **5 F (final)**, 6 WET, 7 ET1, 8 HTET, 9 ET2, **10 FET**, 11 WPE, 12 PE, **13 FPE**, 14 Interrupted, **15 Abandoned, 16 Cancelled, 19 Postponed (→ void path)**, 17/18 TX coverage cancelled/suspended.
- Stat keys: `period*1000 + base`; base: 1/2 goals P1/P2, 3/4 yellows, 5/6 reds, 7/8 corners. Period: 0 full game, 1 H1, 2 H2, 3 ET1, 4 ET2, 5 pens.

## Architecture decision (latency)

Mainnet free tier level 12 = real-time ⇒ **agent prices from mainnet stream**. Program + settlement on devnet (level 1, 60s delay — fine for post-FT settlement). Two free credential sets, one wallet.
