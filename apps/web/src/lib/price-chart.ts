// Pure geometry/formatting helpers for src/components/price-chart.tsx.
// Kept dependency-free (no "use client", no React) so vitest can import
// directly — same split as src/lib/match-list.ts / src/lib/fpmm.ts.

// SVG viewBox dimensions the chart is drawn in (viewBox="0 0 CHART_W
// CHART_H"), scaled to 100% width by the component's wrapping <svg>. Y axis
// is a straight 0-100¢ scale: 0¢ -> CHART_H (bottom), 100¢ -> 0 (top) —
// matches the approved mockup's gridlines (75¢ at y=40, 50¢ at y=80, 25¢ at
// y=120 of a 160-tall viewBox: y = CHART_H - (cents/100)*CHART_H).
export const CHART_W = 640;
export const CHART_H = 160;

// The three gridlines the brief calls for, as {cents, y} pairs ready to draw.
export const GRIDLINES: Array<{ cents: number; y: number }> = [25, 50, 75].map((cents) => ({
  cents,
  y: CHART_H - (cents / 100) * CHART_H,
}));

export type ChartPoint = { t: number; v: number | null };

// Exported so the component can place the current-price dot and goal-marker
// lines at exactly the same coordinates toPath() draws its lines at,
// instead of re-deriving the same x/y math a second time.
export function xFor(t: number, tMin: number, tMax: number): number {
  const span = tMax - tMin;
  if (span <= 0) return 0;
  return ((t - tMin) / span) * CHART_W;
}

export function yFor(cents: number): number {
  const clamped = Math.max(0, Math.min(100, cents));
  return CHART_H - (clamped / 100) * CHART_H;
}

// Maps a (possibly gapped) series to an SVG path `d` string. A `v: null`
// point (no consensus fair price yet) breaks the line rather than being
// bridged or dropped silently: each contiguous run of non-null points
// becomes its own "M...L...L..." subpath, so a `<path d={toPath(...)}>`
// naturally renders as several disconnected segments instead of drawing a
// straight line across a gap it has no data for.
export function toPath(points: ChartPoint[], tMin: number, tMax: number): string {
  const subpaths: string[] = [];
  let current: string | null = null;

  for (const p of points) {
    if (p.v === null) {
      current = null;
      continue;
    }
    const x = xFor(p.t, tMin, tMax);
    const y = yFor(p.v);
    if (current === null) {
      subpaths.push(`M${x},${y}`);
      current = "started";
    } else {
      subpaths[subpaths.length - 1] += ` L${x},${y}`;
    }
  }

  return subpaths.join(" ");
}

export type Window = "1H" | "MATCH" | "ALL";

const ONE_HOUR_MS = 60 * 60 * 1000;

// Client-side slice of an already-fetched series — no refetch, per the
// global "SSE-fed cache only" constraint. `matchStartMs` is the fixture's
// kickoff (Fixture.StartTime); `nowMs` is the caller's Date.now() (passed in
// rather than read here so this stays pure/testable).
//
// "MATCH" bounds to kickoff-onward once the match has actually started, but
// falls back to no bound (same as "ALL") while still pre-kickoff: a market
// can trade for hours before its fixture starts (real seed data on this
// project's devnet fixtures shows this — see task-13-report.md), and a
// window literally defined as "since kickoff" would otherwise show a blank
// chart for the entire pre-match period despite there being real price
// history to show.
export function windowStart(window: Window, matchStartMs: number, nowMs: number): number {
  if (window === "1H") return nowMs - ONE_HOUR_MS;
  if (window === "MATCH") return nowMs < matchStartMs ? -Infinity : matchStartMs;
  return -Infinity; // ALL
}

// Finds the last point at or before `targetTs` — used for the "vs 5-min-ago"
// readout delta. Points are assumed ts-ascending (ring buffer append order).
export function pointAtOrBefore<T extends { ts: number }>(points: T[], targetTs: number): T | undefined {
  let found: T | undefined;
  for (const p of points) {
    if (p.ts > targetTs) break;
    found = p;
  }
  return found;
}

// `⚽ {mm}' T{team}` goal-marker label — clockSeconds is the only source of
// match-minute we have (GoalEvent carries no `mm` field), so a null clock
// (packet arrived without one) degrades to a team-only label rather than
// fabricating a minute.
export function goalLabel(clockSeconds: number | null, team: 1 | 2): string {
  if (clockSeconds === null) return `⚽ T${team}`;
  const mm = Math.floor(clockSeconds / 60);
  return `⚽ ${mm}' T${team}`;
}

// ▲/▼ delta-vs-reference label for the big ¢ readout, e.g. "▲ 9" / "▼ 3" /
// "— 0". `current`/`reference` are already-rounded integer cents.
export function deltaLabel(current: number, reference: number): string {
  const diff = current - reference;
  if (diff > 0) return `▲ ${diff}`;
  if (diff < 0) return `▼ ${Math.abs(diff)}`;
  return `— 0`;
}
