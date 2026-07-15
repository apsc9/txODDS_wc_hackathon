/**
 * P&L report: agent positions (on-chain) × current pool prices (web API)
 * plus the decision log's trade history. Usage: npm run report
 */
import { PublicKey } from "@solana/web3.js";
import { readDecisions, type DecisionRecord } from "./log.js";
import { fetchOpenMarkets, createProgram } from "./trader.js";
import type { AgentMarket } from "./engine.js";
import { DEFAULT_LOG_PATH, parseArgs } from "./config.js";
import { fileURLToPath } from "node:url";
import path from "node:path";

export type ReportPosition = {
  market: string;
  yesShares: bigint;
  noShares: bigint;
  costPaid: bigint;
  claimed: boolean;
};

export type ReportRow = {
  marketPda: string;
  status: AgentMarket["status"];
  costUnits: bigint;
  markUnits: bigint;
  pnlUnits: bigint;
};

export function buildReport(
  recs: DecisionRecord[],
  positions: ReportPosition[],
  markets: AgentMarket[]
): ReportRow[] {
  const byPda = new Map(markets.map((m) => [m.pda, m]));
  const rows: ReportRow[] = [];
  for (const p of positions) {
    const m = byPda.get(p.market);
    if (!m) continue;
    let markUnits: bigint;
    if (m.status === "ResolvedYes") markUnits = p.yesShares;
    else if (m.status === "ResolvedNo") markUnits = p.noShares;
    else if (m.status === "Voided") markUnits = p.costPaid;
    else {
      // Open: mark to pool-implied price, ppm-precision integer math.
      const yesPpm = BigInt(m.yesPpm);
      markUnits = (p.yesShares * yesPpm + p.noShares * (1_000_000n - yesPpm)) / 1_000_000n;
    }
    rows.push({
      marketPda: p.market,
      status: m.status,
      costUnits: p.costPaid,
      markUnits,
      pnlUnits: markUnits - p.costPaid,
    });
  }
  return rows;
}

const fmt = (u: bigint) => (Number(u) / 1_000_000).toFixed(2);

async function main() {
  const cfg = parseArgs(process.argv.slice(2));
  const recs = readDecisions(cfg.logPath);
  const { program, keypair } = createProgram();

  // Fetch-all + filter by owner — memcmp filters are flaky on public devnet
  // RPC (same judgment as chain.ts's poll and resolve-markets.ts).
  const allPositions: any[] = await (program.account as any).position.all();
  const mine: ReportPosition[] = allPositions
    .filter((p) => p.account.owner.equals(keypair.publicKey))
    .map((p) => ({
      market: (p.account.market as PublicKey).toBase58(),
      yesShares: BigInt(p.account.yesShares.toString()),
      noShares: BigInt(p.account.noShares.toString()),
      costPaid: BigInt(p.account.costPaid.toString()),
      claimed: p.account.claimed as boolean,
    }));

  const markets = await fetchOpenMarkets(cfg.apiBase, cfg.fixtureIds);
  const rows = buildReport(recs, mine, markets);

  const trades = recs.filter((r) => r.kind === "trade" && r.tx);
  console.log(`\nTouchline P&L — agent ${keypair.publicKey.toBase58()}`);
  console.log(`trades executed: ${trades.length}, log: ${cfg.logPath}\n`);
  console.table(
    rows.map((r) => ({
      market: r.marketPda.slice(0, 8),
      status: r.status,
      cost: fmt(r.costUnits),
      mark: fmt(r.markUnits),
      pnl: fmt(r.pnlUnits),
    }))
  );
  const total = rows.reduce((a, r) => a + r.pnlUnits, 0n);
  console.log(`TOTAL P&L: ${fmt(total)} test-USDC`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((e) => {
    console.error("[report] FAILED:", e.message ?? e);
    process.exit(1);
  });
}
