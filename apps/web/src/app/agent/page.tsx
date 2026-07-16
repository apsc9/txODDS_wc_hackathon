import Link from "next/link";

import { ensureStarted } from "@/server/boot";
import { hub } from "@/server/feedhub";
import { fetchPositions } from "@/server/chain";
import { AGENT_PUBKEY, readAgentLog } from "@/server/agent-data";
import {
  buildAgentReport,
  extractResolveTx,
  formatUnits,
  ppmToCents,
  safeUnits,
  summarizeSkips,
  type AgentReportRow,
  type DecisionRecord,
} from "@/lib/agent-report";
import { predicateHuman } from "@/lib/statkeys";
import type { Fixture, MarketDTO, PositionDTO } from "@/lib/types";

const SKIP_LIST_CAP = 200;

// Same reasoning as portfolio/page.tsx: output depends on live in-memory hub
// state + the on-disk decision log, both of which change between requests.
export const dynamic = "force-dynamic";

const EXPLORER = process.env.NEXT_PUBLIC_EXPLORER ?? "https://explorer.solana.com";
const explorerTx = (sig: string) => `${EXPLORER}/tx/${sig}?cluster=devnet`;

const shortPda = (s: string) => (s.length > 12 ? `${s.slice(0, 4)}…${s.slice(-4)}` : s);

const SOURCE_LABEL = {
  live: "LIVE LOG",
  sample: "SAMPLE RUN — ENG-ARG JUL 16",
  none: "NO LOG",
} as const;

export default async function AgentPage() {
  // Fresh clones (no TXLINE_CREDS/TXLINE_API) throw a SetupError here. That's
  // fine for the live app, but this page also serves a committed sample log
  // for judges — don't let a missing feed boot block the whole dashboard.
  try {
    ensureStarted();
  } catch (err) {
    console.error("[agent] feed boot failed:", err);
  }

  const log = readAgentLog();
  const markets = Array.from(hub.marketCache.values());
  const fixtures = hub.fixtures;

  // Chain fetch is best-effort: on RPC failure the decision feed (from the
  // local log) still renders; only the P&L section degrades, with a note.
  let positions: PositionDTO[] | null = null;
  try {
    positions = await fetchPositions(AGENT_PUBKEY);
  } catch (err) {
    console.error("[agent] positions fetch failed:", err);
  }

  const rows = positions ? buildAgentReport(positions, markets) : [];
  const totalPnl = rows.reduce((a, r) => a + r.pnlUnits, 0n);
  const byPda = new Map(markets.map((m) => [m.pda, m]));

  const trades = log.records
    .filter((r) => r.kind === "trade" && r.tx)
    .sort((a, b) => b.ts - a.ts);
  const keeperLines = log.records
    .filter((r) => r.kind === "resolve" && r.detail)
    .sort((a, b) => b.ts - a.ts);
  const skips = summarizeSkips(log.records);

  const empty = log.source === "none" && trades.length === 0 && rows.length === 0;
  const syncing = positions !== null && positions.length > 0 && rows.length === 0;

  return (
    <main className="mx-auto max-w-5xl px-6 py-10">
      <header className="mb-10">
        <div className="flex flex-wrap items-baseline gap-x-4 gap-y-2">
          <h1 className="font-display text-3xl font-bold text-[var(--chalk)]">
            TOUCHLINE <span className="text-[var(--gold)]">AGENT</span>
          </h1>
          <span className="text-sm text-[var(--t3)]">{shortPda(AGENT_PUBKEY)}</span>
          <span className="border border-[var(--line)] px-2 py-0.5 text-xs tracking-widest text-[var(--t3)]">
            {SOURCE_LABEL[log.source]}
          </span>
        </div>
        {syncing ? (
          <p className="mt-4 text-sm text-[var(--t3)]">
            positions syncing — market data not loaded yet
          </p>
        ) : positions ? (
          <p className="mt-4 text-lg">
            <span className="text-[var(--t3)]">TOTAL P&amp;L&nbsp;</span>
            <span
              className={`font-display text-2xl font-bold ${
                totalPnl >= 0n ? "text-emerald-400" : "text-red-400"
              }`}
            >
              {totalPnl >= 0n ? "+" : ""}
              {formatUnits(totalPnl)}
            </span>
            <span className="text-[var(--t3)]"> test-USDC</span>
          </p>
        ) : (
          <p className="mt-4 text-sm text-[var(--t3)]">
            chain unreachable — positions &amp; P&amp;L unavailable, decision log below
          </p>
        )}
      </header>

      {empty ? (
        <section className="border border-[var(--line)] p-8 text-[var(--t3)]">
          <p className="mb-2 text-[var(--t2)]">No agent activity yet.</p>
          <p className="font-mono text-sm">cd packages/agent &amp;&amp; npm run agent</p>
        </section>
      ) : (
        <>
          {positions && rows.length > 0 && (
            <PositionsTable rows={rows} byPda={byPda} fixtures={fixtures} />
          )}
          {trades.length > 0 && (
            <TradeFeed trades={trades} byPda={byPda} fixtures={fixtures} />
          )}
          {keeperLines.length > 0 && <KeeperActions lines={keeperLines} />}
          {skips.total > 0 && <Skips skips={skips} records={log.records} />}
        </>
      )}
    </main>
  );
}

function sectionTitle(text: string) {
  return (
    <h2 className="mb-4 font-display text-xl font-bold tracking-wide text-[var(--chalk)]">
      {text}
    </h2>
  );
}

function marketLabel(
  byPda: Map<string, MarketDTO>,
  fixtures: Map<number, Fixture>,
  pda: string
): string {
  const m = byPda.get(pda);
  if (!m) return shortPda(pda);
  const fx = fixtures.get(m.fixtureId);
  return predicateHuman(m, fx?.Participant1, fx?.Participant2);
}

function PositionsTable({
  rows,
  byPda,
  fixtures,
}: {
  rows: AgentReportRow[];
  byPda: Map<string, MarketDTO>;
  fixtures: Map<number, Fixture>;
}) {
  return (
    <section className="mb-10">
      {sectionTitle("POSITIONS")}
      <div className="overflow-x-auto border border-[var(--line)]">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-[var(--line)] text-left text-xs tracking-widest text-[var(--t3)]">
              <th className="px-4 py-2 font-normal">MARKET</th>
              <th className="px-4 py-2 font-normal">STATUS</th>
              <th className="px-4 py-2 text-right font-normal">COST</th>
              <th className="px-4 py-2 text-right font-normal">MARK</th>
              <th className="px-4 py-2 text-right font-normal">P&amp;L</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.marketPda} className="border-b border-[var(--line)] last:border-b-0">
                <td className="px-4 py-2 text-[var(--t2)]">
                  <Link href={`/receipt/${r.marketPda}`} className="hover:text-[var(--chalk)]">
                    {marketLabel(byPda, fixtures, r.marketPda)}
                  </Link>
                </td>
                <td className="px-4 py-2 text-[var(--t3)]">{r.status}</td>
                <td className="px-4 py-2 text-right text-[var(--t2)]">{formatUnits(r.costUnits)}</td>
                <td className="px-4 py-2 text-right text-[var(--t2)]">{formatUnits(r.markUnits)}</td>
                <td
                  className={`px-4 py-2 text-right ${
                    r.pnlUnits >= 0n ? "text-emerald-400" : "text-red-400"
                  }`}
                >
                  {r.pnlUnits >= 0n ? "+" : ""}
                  {formatUnits(r.pnlUnits)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function TradeFeed({
  trades,
  byPda,
  fixtures,
}: {
  trades: DecisionRecord[];
  byPda: Map<string, MarketDTO>;
  fixtures: Map<number, Fixture>;
}) {
  return (
    <section className="mb-10">
      {sectionTitle(`TRADES (${trades.length})`)}
      <ul className="border border-[var(--line)]">
        {trades.map((t) => {
          const amt = safeUnits(t.amountInUnits);
          return (
            <li
              key={t.tx}
              className="flex flex-wrap items-baseline gap-x-3 gap-y-1 border-b border-[var(--line)] px-4 py-2 text-sm last:border-b-0"
            >
              <span
                className={`w-8 font-bold ${t.side === "YES" ? "text-emerald-400" : "text-red-400"}`}
              >
                {t.side}
              </span>
              <span className="text-[var(--t2)]">{marketLabel(byPda, fixtures, t.marketPda)}</span>
              {t.fairPpm != null && t.poolPpm != null && (
                <span className="text-[var(--t3)]">
                  fair {ppmToCents(t.fairPpm)}¢ vs pool {ppmToCents(t.poolPpm)}¢
                  {t.edgePpm != null && ` · edge ${ppmToCents(t.edgePpm)}¢`}
                </span>
              )}
              {amt !== null && (
                <span className="text-[var(--t3)]">{formatUnits(amt)} in</span>
              )}
              <a
                href={explorerTx(t.tx!)}
                target="_blank"
                rel="noreferrer"
                className="ml-auto font-mono text-xs text-[var(--gold)] hover:underline"
              >
                {shortPda(t.tx!)} ↗
              </a>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function KeeperActions({ lines }: { lines: DecisionRecord[] }) {
  return (
    <section className="mb-10">
      {sectionTitle(`KEEPER (${lines.length})`)}
      <ul className="border border-[var(--line)]">
        {lines.map((r, i) => {
          const tx = extractResolveTx(r.detail!);
          const text = tx ? r.detail!.slice(0, r.detail!.lastIndexOf(" tx ")) : r.detail!;
          return (
            <li
              key={`${r.ts}-${i}`}
              className="flex items-baseline gap-3 border-b border-[var(--line)] px-4 py-2 font-mono text-xs text-[var(--t2)] last:border-b-0"
            >
              <span className="min-w-0 flex-1 break-words">{text}</span>
              {tx && (
                <a
                  href={explorerTx(tx)}
                  target="_blank"
                  rel="noreferrer"
                  className="shrink-0 text-[var(--gold)] hover:underline"
                >
                  {shortPda(tx)} ↗
                </a>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function Skips({
  skips,
  records,
}: {
  skips: { total: number; byReason: Array<[string, number]> };
  records: DecisionRecord[];
}) {
  const breakdown = skips.byReason.map(([r, n]) => `${n} ${r}`).join(", ");
  // Summary (total + breakdown) is computed above from ALL skip records; the
  // list itself is sliced to the newest SKIP_LIST_CAP rows so a long-running
  // agent (thousands of skips) doesn't ship a multi-hundred-KB HTML payload
  // on this force-dynamic page — the remainder is just a count, not dropped
  // data (nothing else on the page reads the full list).
  const allLines = records.filter((r) => r.kind === "skip").sort((a, b) => b.ts - a.ts);
  const lines = allLines.slice(0, SKIP_LIST_CAP);
  const hiddenCount = allLines.length - lines.length;
  return (
    <section className="mb-10">
      <details className="border border-[var(--line)]">
        <summary className="cursor-pointer px-4 py-2 text-sm text-[var(--t3)]">
          {skips.total} skips — {breakdown}
        </summary>
        <ul className="max-h-96 overflow-y-auto border-t border-[var(--line)]">
          {lines.map((r, i) => (
            <li
              key={`${r.ts}-${i}`}
              className="border-b border-[var(--line)] px-4 py-1 font-mono text-xs text-[var(--t3)] last:border-b-0"
            >
              {new Date(r.ts).toISOString().slice(11, 19)} {r.reason} {shortPda(r.marketPda)}
              {r.edgePpm != null && ` edge ${ppmToCents(r.edgePpm)}¢`}
            </li>
          ))}
          {hiddenCount > 0 && (
            <li className="px-4 py-1 font-mono text-xs text-[var(--t3)] italic last:border-b-0">
              +{hiddenCount.toLocaleString()} more not shown
            </li>
          )}
        </ul>
      </details>
    </section>
  );
}
