// Pure join/classification/formatting helpers for Task 16's portfolio +
// claim/refund UI (src/hooks/use-positions.ts, src/components/ticket-stub.tsx).
// Kept dependency-free (no "use client", no React) so vitest can import
// directly — same split as src/lib/price-chart.ts / src/lib/match-list.ts.

import type { MarketDTO, PositionDTO } from "./types";

export type Ticket = { position: PositionDTO; market: MarketDTO };

// joinPositions — client-side join of the /api/positions rows against the
// SSE-fed ["markets"] cache (use-markets.ts composition precedent per the
// Task 16 brief's ambiguity resolution), so a ticket's displayed price/state
// always reflects the live market, not a snapshot taken at position-fetch
// time. A position whose market isn't (yet) present in the markets cache is
// dropped rather than shown with an undefined/fabricated market — this only
// happens transiently, before the SSE "markets" push has populated the
// cache for a session that hasn't visited a page seeding it yet.
export function joinPositions(positions: PositionDTO[], markets: MarketDTO[]): Ticket[] {
  const byPda = new Map(markets.map((m) => [m.pda, m]));
  const out: Ticket[] = [];
  for (const position of positions) {
    const market = byPda.get(position.market);
    if (market) out.push({ position, market });
  }
  return out;
}

// StubState — mirrors programs/fulltime/src/lib.rs's `claim()` branch
// exactly (see task-16-report.md for the excerpt this was checked against):
//   ResolvedYes -> amount = yes_shares · ResolvedNo -> amount = no_shares ·
//   Voided -> amount = cost_paid · require!(amount > 0, NothingToClaim).
// "Worthless" is the one state the brief's prose doesn't name explicitly: a
// resolved (non-voided), unclaimed position whose winning-side shares are
// zero (e.g. the trader only ever bought the losing side). Calling claim()
// there would just revert with NothingToClaim, so TicketStub renders it as
// a dead ticket instead of a button that always fails.
export type StubState = "Open" | "Claimable" | "Refundable" | "Claimed" | "Worthless";

export function classifyStub(p: PositionDTO, m: MarketDTO): StubState {
  if (m.status === "Open") return "Open";
  if (p.claimed) return "Claimed";
  if (m.status === "Voided") return "Refundable";
  // ResolvedYes / ResolvedNo
  const winningShares = m.status === "ResolvedYes" ? BigInt(p.yesShares) : BigInt(p.noShares);
  return winningShares > 0n ? "Claimable" : "Worthless";
}

// claimAmount — the exact base-unit amount the on-chain `claim()` transfers
// for this ticket right now (0 for Open/Claimed/Worthless, where no claim
// ix would be sent). Matches the on-chain match arm 1:1.
export function claimAmount(p: PositionDTO, m: MarketDTO): bigint {
  if (m.status === "ResolvedYes") return BigInt(p.yesShares);
  if (m.status === "ResolvedNo") return BigInt(p.noShares);
  if (m.status === "Voided") return BigInt(p.costPaid);
  return 0n;
}

// currentValue — Open-state mark-to-market: shares priced at the live pool's
// implied probability (yesPpm/1e6 for YES shares, the complement for NO
// shares), reusing impliedProbPpm's ppm convention from lib/fpmm.ts (this
// file doesn't need to call it directly since MarketDTO already carries the
// computed yesPpm). Integer bigint math throughout — no float touches the
// amount itself, only the final display formatting (formatUsd) does.
export function currentValue(p: PositionDTO, m: MarketDTO): bigint {
  const yesShares = BigInt(p.yesShares);
  const noShares = BigInt(p.noShares);
  const yesPpm = BigInt(m.yesPpm);
  const noPpm = 1_000_000n - yesPpm;
  return (yesShares * yesPpm + noShares * noPpm) / 1_000_000n;
}

// formatUsd — display-only base-units -> USDC string, 6 decimals per the
// Task 16 brief ("amounts u64 base units, 6 decimals, format Number(x)/1e6").
export function formatUsd(base: bigint): string {
  return (Number(base) / 1_000_000).toFixed(2);
}

// sharesLabel — "40 YES", "12 NO", "40 YES / 12 NO" (both sides bought
// across separate trades), or "0" for an empty position. Mirrors the v4
// mockup's ticket-stub copy ("40 YES") — see
// .superpowers/brainstorm/20358-1783435793/content/fixture-page-v4.html.
export function sharesLabel(p: PositionDTO): string {
  const yes = BigInt(p.yesShares);
  const no = BigInt(p.noShares);
  if (yes > 0n && no > 0n) return `${formatUsd(yes)} YES / ${formatUsd(no)} NO`;
  if (yes > 0n) return `${formatUsd(yes)} YES`;
  if (no > 0n) return `${formatUsd(no)} NO`;
  return "0";
}
