import fs from "node:fs";
import path from "node:path";

// One line per decision. bigint fields are serialized as decimal strings
// (same convention as MarketDTO's u64 fields).
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
  detail?: string; // keeper result lines
};

export function appendDecision(filePath: string, rec: DecisionRecord): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.appendFileSync(filePath, JSON.stringify(rec) + "\n");
}

export function readDecisions(filePath: string): DecisionRecord[] {
  if (!fs.existsSync(filePath)) return [];
  const out: DecisionRecord[] = [];
  const lines = fs
    .readFileSync(filePath, "utf8")
    .split("\n")
    .filter((l) => l.trim().length > 0);
  for (const l of lines) {
    try {
      out.push(JSON.parse(l) as DecisionRecord);
    } catch {
      const truncated = l.length > 120 ? `${l.slice(0, 120)}...` : l;
      console.warn(`[log] skipping corrupt decision line: ${truncated}`);
    }
  }
  return out;
}

// Restart safety: replay the log so per-market/global caps survive process
// restarts. Only successful trades (kind trade, tx set, no error) count.
export function rebuildExposure(recs: DecisionRecord[]): {
  perMarket: Map<string, bigint>;
  globalUnits: bigint;
} {
  const perMarket = new Map<string, bigint>();
  let globalUnits = 0n;
  for (const r of recs) {
    if (r.kind !== "trade" || !r.tx || r.error || !r.amountInUnits) continue;
    const amt = BigInt(r.amountInUnits);
    perMarket.set(r.marketPda, (perMarket.get(r.marketPda) ?? 0n) + amt);
    globalUnits += amt;
  }
  return { perMarket, globalUnits };
}
