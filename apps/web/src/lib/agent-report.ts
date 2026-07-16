// Pure helpers for the /agent dashboard (src/app/agent/page.tsx). Lifted from
// packages/agent (log.ts DecisionRecord + report.ts buildReport) — packages
// are standalone (no npm workspaces), so small pure-fn duplication is the
// repo convention, same as lib/fpmm.ts vs packages/agent/src/fpmm.ts.
// Dependency-free (no "use client", no React, no fs) so vitest imports
// directly — same split as lib/positions.ts / lib/match-list.ts.

import type { MarketDTO, PositionDTO } from "./types";

// Verbatim from packages/agent/src/log.ts. bigint fields are serialized as
// decimal strings (same convention as MarketDTO's u64 fields).
export type DecisionRecord = {
  ts: number;
  fixtureId: number;
  marketPda: string;
  kind: "trade" | "resolve" | "skip";
  reason?: string;
  fairPpm?: number;
  poolPpm?: number;
  edgePpm?: number | null;
  side?: "YES" | "NO";
  amountInUnits?: string;
  quotedShares?: string;
  minSharesOut?: string;
  tx?: string;
  error?: string;
  detail?: string;
};

// Tolerant JSONL parse: a corrupt/truncated line (e.g. from a killed agent
// process mid-write) is skipped, not fatal — mirrors packages/agent
// readDecisions' hardening, minus the fs read (caller supplies text).
export function parseDecisionLog(text: string): DecisionRecord[] {
  const out: DecisionRecord[] = [];
  for (const line of text.split("\n")) {
    if (line.trim().length === 0) continue;
    try {
      out.push(JSON.parse(line) as DecisionRecord);
    } catch {
      // corrupt line — skip
    }
  }
  return out;
}

export type AgentReportRow = {
  marketPda: string;
  status: MarketDTO["status"];
  costUnits: bigint;
  markUnits: bigint;
  pnlUnits: bigint;
};

// Port of packages/agent/src/report.ts buildReport, adapted to the web DTOs
// (PositionDTO carries decimal strings; MarketDTO carries status + yesPpm).
// Positions whose market is absent from the cache are skipped (agent parity).
export function buildAgentReport(
  positions: PositionDTO[],
  markets: MarketDTO[]
): AgentReportRow[] {
  const byPda = new Map(markets.map((m) => [m.pda, m]));
  const rows: AgentReportRow[] = [];
  for (const p of positions) {
    const m = byPda.get(p.market);
    if (!m) continue;
    const yesShares = BigInt(p.yesShares);
    const noShares = BigInt(p.noShares);
    const costPaid = BigInt(p.costPaid);
    let markUnits: bigint;
    if (m.status === "ResolvedYes") markUnits = yesShares;
    else if (m.status === "ResolvedNo") markUnits = noShares;
    else if (m.status === "Voided") markUnits = costPaid;
    else {
      // Open: mark to pool-implied price, ppm-precision integer math.
      const yesPpm = BigInt(m.yesPpm);
      markUnits = (yesShares * yesPpm + noShares * (1_000_000n - yesPpm)) / 1_000_000n;
    }
    rows.push({
      marketPda: p.market,
      status: m.status,
      costUnits: costPaid,
      markUnits,
      pnlUnits: markUnits - costPaid,
    });
  }
  return rows;
}

export function summarizeSkips(recs: DecisionRecord[]): {
  total: number;
  byReason: Array<[string, number]>;
} {
  const counts = new Map<string, number>();
  let total = 0;
  for (const r of recs) {
    if (r.kind !== "skip") continue;
    total++;
    const reason = r.reason ?? "unknown";
    counts.set(reason, (counts.get(reason) ?? 0) + 1);
  }
  return { total, byReason: [...counts.entries()].sort((a, b) => b[1] - a[1]) };
}

// Keeper `resolve` records carry everything in a free-text `detail` line;
// successful ones end with "tx <base58 sig>" (see resolve-markets.ts output).
export function extractResolveTx(detail: string): string | null {
  const m = detail.match(/ tx ([1-9A-HJ-NP-Za-km-z]{32,88})\s*$/);
  return m ? m[1] : null;
}

// Base units (1e-6 test-USDC) → 2dp display string. Number() is display-only
// precision loss, fine at demo scale (same judgment as report.ts's fmt).
export function formatUnits(u: bigint): string {
  return (Number(u) / 1_000_000).toFixed(2);
}

export function ppmToCents(ppm: number): number {
  return Math.round(ppm / 10_000);
}
