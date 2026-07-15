# TxLINE API Feedback Log

Running log of our team's experience with the TxLINE API during the World Cup hackathon.
(Required submission field — kept honest and specific from day 1.)

## Liked

- **2026-07-03** — `llms.txt` docs index + markdown-served doc pages (`.md` suffix) made programmatic doc consumption painless. More APIs should do this.
- **2026-07-03** — Free World Cup tier including a *real-time* level (mainnet service level 12) is generous; no-payment on-chain subscription is a clever auth pattern.
- **2026-07-03** — `validate_stat` predicate design (two stats + Add/Subtract + comparison, period-encoded stat keys) is expressive enough for parametric props without custom oracle code.
- **2026-07-03** — On-chain validation example includes exact PDA derivation and byte-conversion helpers — saved us real time.

## Friction

- **2026-07-03** — IDL & Types docs pages embed the IDL only inside syntax-highlighted HTML (~9 MB page). A raw downloadable `txoracle.json` (and `.ts`) link would save scraping. (Workaround: extracted JSON by brace-matching the stripped HTML.)
- **2026-07-03** — Superteam listing pages say "no rate limits" but the docs quickstart doesn't state SSE reconnect semantics (Last-Event-ID resume supported?). Unclear whether missed packets during reconnect are recoverable except via `updates/{epochDay}/{hourOfDay}/{interval}` backfill.
- **2026-07-03** — Devnet pricing matrix documents only service level 1 (60s delay); if devnet had a real-time row, full end-to-end devnet demos (feed + settlement on one network) would be simpler.
- **2026-07-03** — Docs example requests 1.4M CU for `validate_stat` — actual cost figure undocumented; matters a lot for anyone CPI-ing it from their own program. (Will measure and report.)

- **2026-07-03** — `subscribe` fails with `AccountNotInitialized` (3012) on `user_token_account` if the wallet has no TxL ATA — even for free tiers where no TxL moves. The World Cup quickstart never mentions creating the ATA. Suggest: docs add a `createAssociatedTokenAccountIdempotentInstruction` pre-instruction to the example, or the program tolerate a missing ATA for zero-price rows.

## Liked (verified hands-on)

- **2026-07-03** — `validate_stat` actual cost ≈ **199K CU**, far below the 1.4M budget in docs — CPI-friendly. Worth documenting the real number; it materially changes integrator design.
- **2026-07-03** — `TXLineStablePriceDemargined` stream with `Pct` implied probabilities is exactly what algorithmic consumers want; saved us writing de-vig logic.

## Friction (settlement semantics)

- **2026-07-05** — **Zero-valued stats are unprovable.** `/api/scores/stat-validation` happily returns a proof for a stat with `value: 0`, but on-chain `validate_stat` rejects it with `StatNotZero` (6074, `utils.rs:221`, "R2 validation" phase). Undocumented, with real consequences for anyone settling markets on TxLINE: any predicate whose truth requires exhibiting a zero stat (e.g. proving a clean sheet, or resolving "over 0.5 goals" as NO after a 0-0) cannot be settled directly and needs a void/timeout fallback. Either the docs should state that only nonzero stat values are provable by inclusion, or the API should refuse to emit proofs the oracle will reject (e.g. 409 with an explanation).

## Friction (live match findings, 2026-07-15/16)

- **2026-07-15** — **Zero-stat unprovability, confirmed live and end-to-end.** France scored 0 in France–Spain (18237038); every "France to score / total goals over N" market that should settle from the France goal count is unresolvable by inclusion proof (`StatNotZero`, see the 2026-07-05 entry). We handle it with a permissionless void-after-deadline path so escrow is never stuck, but this is a real gap for any settlement integrator. Concrete ask: an **absence/zero attestation** — a signed proof that a stat's value *is* 0 at a given update — would make "team fails to score", clean-sheet, and under/over-as-NO outcomes directly settleable instead of forcing a timeout void.
- **2026-07-15** — **FT and first-half odds series are indistinguishable except by `MarketPeriod`.** The feed carries a full-time series and a `half=1` series that share the same `SuperOddsType` and `MarketParameters` (line/handicap). Keying consensus prices on `(SuperOddsType, MarketParameters)` alone silently clobbers one series with the other (we saw a fair-price line sawtooth between the FT and half values). Only `MarketPeriod` disambiguates them, and nothing in the docs flags this collision. Suggest documenting that `MarketPeriod` is part of the identity of an odds series, not just metadata.
- **2026-07-15** — **`GameState` stays `"scheduled"` through the entire match, including after `game_finalised`.** Across a full 18237038 capture (~1000 score packets, kickoff → full time), `GameState` never left `"scheduled"` — even on the `game_finalised` packet. A consumer that trusts `GameState` for live/finished classification gets it wrong for the whole match; we had to infer "live" from the presence of recent score packets instead. The real full-time signal appears to be the **`Action` field on the `game_finalised` packet** — that (not `GameState`) is what a settlement/keeper trigger should watch. Either `GameState` should track the actual game phase, or the docs should point integrators at `Action` and warn that `GameState` is unreliable on this feed.

## Bugs

_(none confirmed yet — the `GameState` "scheduled"-throughout behavior above may be a bug rather than a doc gap; treating it as friction until confirmed with TxODDS.)_
