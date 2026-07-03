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

## Bugs

_(none confirmed yet)_
