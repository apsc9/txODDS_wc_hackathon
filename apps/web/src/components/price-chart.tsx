"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { GoalEvent, LiveScore, MarketDTO, PricePoint } from "@/lib/types";
import { useHistory, useGoals } from "@/hooks/use-history";
import { predicateHuman, predicateMono } from "@/lib/statkeys";
import { ppmToCents } from "@/lib/fpmm";
import {
  CHART_H,
  CHART_W,
  GRIDLINES,
  deltaLabel,
  goalLabel,
  pointAtOrBefore,
  toPath,
  windowStart,
  xFor,
  yFor,
  type Window,
} from "@/lib/price-chart";

const FIVE_MIN_MS = 5 * 60 * 1000;
const WINDOWS: Window[] = ["1H", "MATCH", "ALL"];

// ---------------------------------------------------------------------------
// PriceChart — pure-SVG price chart for the selected market: gridlines at
// 25/50/75¢, green solid pool-price polyline, gold dashed consensus-fair
// polyline (skipping segments where fair data is absent — see
// src/lib/price-chart.ts's toPath), gold goal markers, a current-price dot +
// big ¢ readout with a ▲/▼-vs-5-min-ago delta, and a client-side 1H/MATCH/ALL
// window toggle (no refetch — just re-slices whatever's already in the
// ["history", pda] cache). Mounted by MarketBoard (src/components/
// market-row.tsx) above the market rows, always showing the currently
// selected market.
// ---------------------------------------------------------------------------

export function PriceChart({
  m,
  t1,
  t2,
  matchStartMs,
  liveScore,
  initialHistory,
  initialGoals,
}: {
  m: MarketDTO;
  t1?: string;
  t2?: string;
  matchStartMs: number;
  liveScore?: LiveScore;
  // Only ever supplied for the market the fixture page's RSC seeded at
  // render time (see src/app/fixture/[fixtureId]/page.tsx +
  // market-row.tsx's `initialSelectedPda` guard) — undefined for any other
  // selection, which just falls back to a real client fetch.
  initialHistory?: PricePoint[];
  initialGoals?: GoalEvent[];
}) {
  const { data: points = [] } = useHistory(m.pda, initialHistory);
  const { data: goals = [] } = useGoals(m.fixtureId, m.pda, initialGoals);
  const queryClient = useQueryClient();
  const [activeWindow, setActiveWindow] = useState<Window>("MATCH");

  // Refresh goal markers when the live score tally for this fixture climbs.
  // There's no SSE "goal" event type (see use-history.ts's useGoals doc
  // comment), so this piggybacks on the "score" SSE stream that's already
  // flowing to MarketBoard: only invalidate on an actual goal-count
  // increase, not on every score packet, so this stays event-driven rather
  // than turning into disguised polling.
  const prevGoalsRef = useRef<{ g1: number; g2: number } | null>(null);
  useEffect(() => {
    if (!liveScore) return;
    const g1 = liveScore.stats["1"] ?? 0;
    const g2 = liveScore.stats["2"] ?? 0;
    const prev = prevGoalsRef.current;
    if (prev && (g1 > prev.g1 || g2 > prev.g2)) {
      queryClient.invalidateQueries({ queryKey: ["goals", m.fixtureId] });
    }
    prevGoalsRef.current = { g1, g2 };
  }, [liveScore, m.fixtureId, queryClient]);

  const now = Date.now();
  const rawTMin = windowStart(activeWindow, matchStartMs, now);
  const visible = useMemo(() => points.filter((p) => p.ts >= rawTMin), [points, rawTMin]);
  const tMax = visible.length > 0 ? visible[visible.length - 1].ts : now;
  // "ALL" (and "MATCH" pre-kickoff — see windowStart's doc comment) has no
  // natural lower bound (windowStart returns -Infinity for both): the
  // earliest point actually in view stands in as the left edge instead,
  // since (finite - (-Infinity)) / Infinity is NaN, not a usable x fraction.
  const tMin = !Number.isFinite(rawTMin) && visible.length > 0 ? visible[0].ts : rawTMin;

  const poolSeries = useMemo(
    () => visible.map((p) => ({ t: p.ts, v: p.poolPpm / 10_000 })),
    [visible]
  );
  const fairSeries = useMemo(
    () => visible.map((p) => ({ t: p.ts, v: p.fairPpm === null ? null : p.fairPpm / 10_000 })),
    [visible]
  );

  // O(n) path-string rebuild over up to ~2000 points — memoized so unrelated
  // MarketBoard re-renders (tab clicks, side toggles) that don't change the
  // series or window don't redo it every time.
  const poolPath = useMemo(() => toPath(poolSeries, tMin, tMax), [poolSeries, tMin, tMax]);
  const fairPath = useMemo(() => toPath(fairSeries, tMin, tMax), [fairSeries, tMin, tMax]);

  const last = visible[visible.length - 1] as PricePoint | undefined;
  const currentCents = last ? ppmToCents(last.poolPpm) : null;
  // exactRefPoint is undefined when there's under 5 minutes of history in
  // view (cold buffer / early in the window) — refPoint then falls back to
  // the earliest visible point instead of a true 5-min-ago sample.
  const exactRefPoint = last ? pointAtOrBefore(visible, last.ts - FIVE_MIN_MS) : undefined;
  const refPoint = last ? (exactRefPoint ?? visible[0]) : undefined;
  const refCents = refPoint ? ppmToCents(refPoint.poolPpm) : null;
  // Human-readable phrase for the aria-label's delta clause. When the
  // 5-min-ago lookback landed on a real sample, keep the fixed "5 minutes
  // ago" wording; otherwise describe the actual gap between `last` and the
  // fallback point so the label doesn't claim a 5-minute baseline it doesn't
  // have.
  const refPeriodLabel = (() => {
    if (!last || !refPoint) return null;
    if (exactRefPoint) return "5 minutes ago";
    const elapsedMs = last.ts - refPoint.ts;
    if (elapsedMs < 1000) return "since start of data";
    if (elapsedMs < 60_000) {
      const secs = Math.round(elapsedMs / 1000);
      return `${secs} second${secs === 1 ? "" : "s"} ago`;
    }
    const mins = Math.round(elapsedMs / 60_000);
    return `${mins} minute${mins === 1 ? "" : "s"} ago`;
  })();

  const dotX = last ? xFor(last.ts, tMin, tMax) : 0;
  const dotY = currentCents !== null ? yFor(currentCents) : 0;

  const visibleGoals = goals.filter((g) => g.ts >= tMin && g.ts <= tMax);

  const title = predicateHuman(m, t1, t2);
  const mono = predicateMono(m);
  const settleMins = Math.round(m.finalityDelaySecs / 60);

  const ariaLabel =
    currentCents !== null
      ? `Price chart for ${title}: currently ${currentCents}¢${
          refCents !== null && refPeriodLabel
            ? `, ${deltaLabel(currentCents, refCents)}¢ versus ${refPeriodLabel}`
            : ""
        }, showing the ${activeWindow} window.`
      : `Price chart for ${title}: no trading history yet.`;

  return (
    <div className="border border-[var(--line)] bg-[var(--surface)] px-[22px] py-[18px]">
      <div className="mb-1 flex items-baseline justify-between">
        <div>
          <span className="text-base font-semibold text-[var(--chalk)]">{title}</span>
          <span className="font-mono-num ml-3 text-[10px] text-[var(--t3)]">
            {mono} · settles FT + {settleMins}m
          </span>
        </div>
        {currentCents !== null && (
          <div className="text-right">
            <div className="font-mono-num text-[22px] text-[var(--yes)]">
              {currentCents}¢{" "}
              {refCents !== null && (
                <span className="text-[11px] text-[var(--t3)]">{deltaLabel(currentCents, refCents)}</span>
              )}
            </div>
            <div className="label">YES · POOL PRICE</div>
          </div>
        )}
      </div>

      <svg
        viewBox={`0 0 ${CHART_W} ${CHART_H}`}
        role="img"
        aria-label={ariaLabel}
        style={{ width: "100%", height: 170, marginTop: 8 }}
      >
        {GRIDLINES.map((g) => (
          <line key={g.cents} x1={0} y1={g.y} x2={CHART_W} y2={g.y} stroke="var(--line)" strokeWidth={1} />
        ))}
        {GRIDLINES.map((g) => (
          <text
            key={g.cents}
            x={CHART_W - 8}
            y={g.y - 4}
            fill="var(--t4)"
            fontSize={9}
            textAnchor="end"
            fontFamily="var(--font-mono)"
          >
            {g.cents}¢
          </text>
        ))}

        {fairPath && (
          <path
            d={fairPath}
            fill="none"
            stroke="var(--gold)"
            strokeWidth={1.5}
            strokeDasharray="5,4"
            opacity={0.8}
          />
        )}
        {poolPath && <path d={poolPath} fill="none" stroke="var(--yes)" strokeWidth={2.2} />}

        {visibleGoals.map((g, i) => {
          const x = xFor(g.ts, tMin, tMax);
          return (
            <g key={i}>
              <line x1={x} y1={20} x2={x} y2={140} stroke="var(--gold)" strokeWidth={1} opacity={0.35} />
              <text x={x} y={14} fill="var(--gold)" fontSize={9} textAnchor="middle" fontFamily="var(--font-mono)">
                {goalLabel(g.clockSeconds, g.team)}
              </text>
            </g>
          );
        })}

        {currentCents !== null && (
          <circle className="chart-dot" cx={dotX} cy={dotY} r={3.5} fill="var(--yes)" />
        )}
      </svg>

      <div className="flex items-center justify-between">
        <div className="font-mono-num flex gap-3.5 text-[9px]">
          <span className="text-[var(--yes)]">— pool price</span>
          <span className="text-[var(--gold)]">--- TxLINE consensus fair</span>
          <span className="text-[var(--t4)]">| goals</span>
        </div>
        <div className="font-mono-num flex gap-2 text-[9px] text-[var(--t3)]">
          {WINDOWS.map((w) => (
            <button
              key={w}
              type="button"
              onClick={() => setActiveWindow(w)}
              className={
                w === activeWindow
                  ? "border border-[var(--gold)] px-2 py-0.5 text-[var(--gold)]"
                  : "border border-[var(--line-hi)] px-2 py-0.5 text-[var(--t3)]"
              }
            >
              {w}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
