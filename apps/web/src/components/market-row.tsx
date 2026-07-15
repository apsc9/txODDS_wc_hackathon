"use client";

import Link from "next/link";
import { useMemo, useState, type KeyboardEvent } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import type { Fixture, GoalEvent, LiveScore, MarketDTO, PricePoint } from "@/lib/types";
import { useFeedUp, useMarkets, useScores } from "@/hooks/use-markets";
import { usePositions } from "@/hooks/use-positions";
import { fixtureDefaultMarket, formatPooled, sumPooled } from "@/lib/match-list";
import { canNeedZeroStat, marketGroup, predicateHuman, predicateMono, type MarketGroup } from "@/lib/statkeys";
import { ppmToCents } from "@/lib/fpmm";
import { Scorebug } from "@/components/scorebug";
import { PriceChart } from "@/components/price-chart";
import { TradeSlip } from "@/components/trade-slip";
import { TicketStub } from "@/components/ticket-stub";
import { CreateMarketModal } from "@/components/create-market-modal";
import type { Side } from "@/hooks/use-trade";

// ---------------------------------------------------------------------------
// MarketRow — one v4-style market row (open or settled). Purely
// presentational: all state (selection, tab filter, live data) lives in
// `MarketBoard` below, which is the client hydration boundary for this
// file (both live here per the Task 11 brief's 3-file cap — see
// task-11-report.md).
// ---------------------------------------------------------------------------

type MarketRowProps = {
  m: MarketDTO;
  selected: boolean;
  onSelect: (m: MarketDTO, side?: "YES" | "NO") => void;
  t1?: string;
  t2?: string;
};

const SETTLED_LABEL: Record<string, string> = {
  ResolvedYes: "YES",
  ResolvedNo: "NO",
  Voided: "VOID",
};

export function MarketRow({ m, selected, onSelect, t1, t2 }: MarketRowProps) {
  const settled = m.status !== "Open";

  function handleKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      onSelect(m);
    }
  }

  if (settled) {
    return (
      <div className="flex items-center justify-between border border-[var(--line)] bg-[var(--bg)] px-4 py-3">
        <div>
          <div className="text-sm text-[var(--t3)]">{predicateHuman(m, t1, t2)}</div>
          <div className="font-mono-num mt-1 text-[11px] text-[var(--t4)]">
            {predicateMono(m)} · settled · proof on-chain
          </div>
        </div>
        <Link
          href={`/receipt/${m.pda}`}
          className="font-mono-num whitespace-nowrap border border-[var(--gold)] px-3 py-1.5 text-[11px] text-[var(--gold)] transition-colors hover:bg-[var(--surface-hi)]"
        >
          ✓ {SETTLED_LABEL[m.status] ?? m.status} · VIEW RECEIPT
        </Link>
      </div>
    );
  }

  const pool = BigInt(m.poolYes) + BigInt(m.poolNo);
  const yesCents = ppmToCents(m.yesPpm);
  const noCents = 100 - yesCents;
  // TxLINE consensus fair price (not the pool's own implied price — that's
  // already shown on the YES/NO buttons via yesPpm/noCents). Omitted
  // entirely when null rather than shown as a dash/placeholder: cards and
  // corners markets have no consensus mapping in fairPpmFor, so a value
  // here would be fabricated, not honest UI.
  const fair = m.fairPpm != null ? (m.fairPpm / 1_000_000).toFixed(2) : null;
  const subtext =
    `${predicateMono(m)} · ${formatPooled(pool)} pool` + (fair !== null ? ` · fair ${fair}` : "");
  const zeroStatWarn = canNeedZeroStat(m);

  return (
    <div
      role="button"
      tabIndex={0}
      aria-pressed={selected}
      onClick={() => onSelect(m)}
      onKeyDown={handleKeyDown}
      className={`flex cursor-pointer items-center justify-between border px-4 py-3 transition-colors ${
        selected
          ? "border-[var(--gold)] bg-[var(--surface-hi)]"
          : "border-[var(--line)] bg-[var(--surface)] hover:border-[var(--line-hi)]"
      }`}
    >
      <div>
        <div className="text-sm text-[var(--chalk)]">{predicateHuman(m, t1, t2)}</div>
        <div className="font-mono-num mt-1 text-[11px] text-[var(--t3)]">{subtext}</div>
        {zeroStatWarn && (
          <div className="font-mono-num mt-1 text-[10px] text-[var(--t4)]">
            settles via void path on 0 outcome — refund at cost basis
          </div>
        )}
      </div>
      <div className="flex shrink-0 gap-2">
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onSelect(m, "YES");
          }}
          className="font-mono-num bg-[var(--yes)] px-3.5 py-1.5 text-[13px] font-semibold text-[var(--bg)]"
        >
          YES {yesCents}¢
        </button>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onSelect(m, "NO");
          }}
          className="font-mono-num border border-[var(--no)] px-3.5 py-1.5 text-[13px] text-[var(--no)]"
        >
          NO {noCents}¢
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// MarketBoard — client hydration boundary for the fixture page: renders the
// scorebug + group tabs + rows, reading the SSE-fed TanStack caches (seeded
// by the RSC page's `initial` snapshot — same pattern as Task 9's
// src/components/match-list.tsx).
// ---------------------------------------------------------------------------

export type MarketBoardInitial = {
  fixture: Fixture;
  scores: Record<number, LiveScore>;
  // The FULL market cache (every fixture), not just this fixture's markets:
  // it seeds the GLOBAL ["markets"] TanStack key via useMarkets, whose
  // initialData must never be a filtered subset (see the fixture page RSC's
  // comment). Everything fixture-scoped below is re-derived from this full
  // list — useMarkets(fixtureId, ...) for display, fixtureDefaultMarket for
  // the initial selection.
  markets: MarketDTO[];
  // RSC-read (no HTTP round trip — same posture as fixture/scores/markets
  // above) history + goals for whichever market
  // `fixtureDefaultMarket(markets, fixtureId)` picks as the default
  // selection, so that market's chart paints with real
  // data on first server-rendered paint. Only ever valid for that one pda —
  // see `initialSelectedPda` below and src/hooks/use-history.ts's doc
  // comment on why passing it for a different pda would be wrong.
  history: PricePoint[];
  goals: GoalEvent[];
};

const GROUPS: MarketGroup[] = ["GOALS", "CORNERS", "CARDS", "RESULT"];

export function MarketBoard({
  fixtureId,
  initial,
  initialFeedUp,
}: {
  fixtureId: number;
  initial: MarketBoardInitial;
  initialFeedUp: boolean;
}) {
  const { data: scores } = useScores(initial.scores);
  const markets = useMarkets(fixtureId, initial.markets);
  const feedUp = useFeedUp(initialFeedUp);
  const { publicKey } = useWallet();
  const { tickets } = usePositions(publicKey?.toBase58());
  const fixtureTickets = useMemo(
    () => tickets.filter((t) => t.market.fixtureId === fixtureId),
    [tickets, fixtureId]
  );

  const score = scores[fixtureId];
  const pooled = sumPooled(markets);

  // Selection defaults to THIS fixture's deepest-pool market at mount
  // (initial.markets is the full cross-fixture cache, so it must be
  // fixture-filtered first — fixtureDefaultMarket does both steps) and is
  // otherwise fully user-driven — deliberately not re-derived on every
  // `markets` update (a live pool shift shouldn't yank the user's current
  // selection out from under them). Drives the trade slip in the rail
  // below: `side` is preset by a row's YES/NO chip click (see
  // `handleSelect`) and otherwise left as the user last set it.
  const initialDefaultMarket = fixtureDefaultMarket(initial.markets, fixtureId);
  const [selected, setSelected] = useState<MarketDTO | undefined>(initialDefaultMarket);
  const [side, setSide] = useState<Side>("YES");
  const [createOpen, setCreateOpen] = useState(false);
  const [activeGroup, setActiveGroup] = useState<MarketGroup>(() =>
    initialDefaultMarket ? marketGroup(initialDefaultMarket) : "GOALS"
  );

  const grouped = useMemo(() => {
    const map = new Map<MarketGroup, MarketDTO[]>();
    for (const g of GROUPS) map.set(g, []);
    for (const m of markets) {
      map.get(marketGroup(m))?.push(m);
    }
    return map;
  }, [markets]);

  function handleSelect(m: MarketDTO, presetSide?: "YES" | "NO") {
    setSelected(m);
    if (presetSide) setSide(presetSide);
  }

  const visible = grouped.get(activeGroup) ?? [];

  // The trade slip needs the *live* market object (pools shift optimistically
  // on buy, then again when the poller reconciles) — `selected` only tracks
  // which pda is picked, so re-look it up in the live `markets` list every
  // render rather than trading against a stale snapshot.
  const selectedLive = selected ? (markets.find((m) => m.pda === selected.pda) ?? selected) : undefined;

  // `initial.history`/`initial.goals` were only ever fetched (server-side,
  // by page.tsx) for this exact pda — this fixture's deepest-pool market at
  // RSC render time. PriceChart must not receive them for any other
  // selection (see src/hooks/use-history.ts), so this is re-derived from
  // the same pure `fixtureDefaultMarket` the RSC used rather than trusted
  // to stay in sync with `selected`.
  const initialSelectedPda = initialDefaultMarket?.pda;

  return (
    <div className="grid grid-cols-1 items-start gap-6 md:grid-cols-[1fr_320px]">
      <div className="flex flex-col gap-5">
        <Scorebug f={initial.fixture} score={score} pooled={pooled} feedUp={feedUp} />

        {selectedLive && (
          <PriceChart
            m={selectedLive}
            t1={initial.fixture.Participant1}
            t2={initial.fixture.Participant2}
            matchStartMs={initial.fixture.StartTime}
            liveScore={score}
            initialHistory={selectedLive.pda === initialSelectedPda ? initial.history : undefined}
            initialGoals={selectedLive.pda === initialSelectedPda ? initial.goals : undefined}
          />
        )}

        <div className="flex items-center gap-5 border-b border-[var(--line)] pb-2.5">
          {GROUPS.map((g) => (
            <button
              key={g}
              type="button"
              onClick={() => setActiveGroup(g)}
              className={
                g === activeGroup
                  ? "font-display -mb-[11px] border-b-2 border-[var(--gold)] pb-2.5 text-sm font-bold tracking-wide text-[var(--chalk)]"
                  : "font-display text-sm font-semibold tracking-wide text-[var(--t3)] transition-colors hover:text-[var(--t2)]"
              }
            >
              {g}
            </button>
          ))}
          <button
            type="button"
            onClick={() => setCreateOpen(true)}
            className="font-display ml-auto text-sm font-semibold tracking-wide text-[var(--gold)] transition-opacity hover:opacity-80"
          >
            + CREATE MARKET
          </button>
        </div>

        <div className="flex flex-col gap-2">
          {visible.length === 0 ? (
            <p className="text-sm text-[var(--t3)]">No markets in this group yet.</p>
          ) : (
            visible.map((m) => (
              <MarketRow
                key={m.pda}
                m={m}
                selected={selected?.pda === m.pda}
                onSelect={handleSelect}
                t1={initial.fixture.Participant1}
                t2={initial.fixture.Participant2}
              />
            ))
          )}
        </div>
      </div>

      <aside className="flex flex-col gap-4 md:sticky md:top-[60px]">
        {selectedLive ? (
          <TradeSlip m={selectedLive} side={side} setSide={setSide} />
        ) : (
          <div className="border border-[var(--line)] bg-[var(--surface)] p-4">
            <h2 className="label mb-2">TRADE</h2>
            <p className="text-xs text-[var(--t4)]">Select a market to trade.</p>
          </div>
        )}

        {fixtureTickets.length > 0 && (
          <div
            className="perf-edge-top relative p-3.5"
            style={{ background: "var(--chalk-dim)", color: "#1a1d1a" }}
          >
            <div
              className="font-display mb-1.5 text-[11px] font-bold tracking-[0.14em]"
              style={{ color: "#555" }}
            >
              YOUR TICKETS · {fixtureTickets.length}
            </div>
            {fixtureTickets.map((t) => (
              <TicketStub key={t.position.pda} p={t.position} m={t.market} compact />
            ))}
          </div>
        )}
      </aside>

      {createOpen && (
        <CreateMarketModal
          f={initial.fixture}
          markets={markets}
          onClose={() => setCreateOpen(false)}
        />
      )}
    </div>
  );
}
