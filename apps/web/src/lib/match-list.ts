// Pure helpers shared by the RSC match-list page (src/app/(home)/page.tsx) and its
// client hydration boundary (src/components/match-list.tsx,
// src/components/fixture-card.tsx). Kept dependency-free (no "server-only",
// no React) so both sides — and vitest — can import it directly.

export type MatchStatus = "live" | "upcoming" | "finished";

// Mirrors src/app/api/fixtures/route.ts's window exactly, so the homepage
// list and that API return the same fixture set. This page reads the hub
// directly rather than calling the route (per the brief — no HTTP
// round-trip from a server component to our own API), but should still
// show "now +/- a sane window", not literally every fixture in the TxLINE
// snapshot (which spans past and far-future test fixtures too — see
// data/recordings/devnet-fixtures-*.json).
export const FIXTURE_WINDOW_BEFORE_MS = 6 * 60 * 60 * 1000;
export const FIXTURE_WINDOW_AFTER_MS = 72 * 60 * 60 * 1000;

// TxLINE's scores-stream `GameState` field is not a usable finished/live
// signal on this feed: re-confirmed live twice (most recently against
// Spain-Belgium, fixture 18218149, full-match capture from kickoff Jul 11 —
// see .superpowers/sdd/progress.md) that it reports "scheduled" for the
// *entire* match, including mid-match goal events. The brief's "gameState
// finished-phase codes 5/10/13 -> finished" rule is written against a field
// that may never leave "scheduled" on this feed, so status here is derived
// instead from (a) whether TxLINE has ever sent a score packet for this
// fixture in this process — the same `hub.scores.has(fixtureId)` signal
// src/app/api/fixtures/route.ts already uses for live-detection — and (b)
// how long ago kickoff was / how long since the last packet arrived, to
// separate "still live" from "match is over, feed's gone quiet": the
// live-scores set alone can't tell those apart, since a fixture stays in
// `hub.scores` with its final score long after full time.
const MAX_MATCH_DURATION_MS = 3 * 60 * 60 * 1000; // normal + ET + pens + delays: generous upper bound
const STALE_SCORE_MS = 20 * 60 * 1000; // no score packet in 20min -> feed's gone quiet, treat as over

export function classifyFixtureStatus(
  startTimeMs: number,
  score: { recvTs: number } | undefined,
  now: number = Date.now()
): MatchStatus {
  if (startTimeMs > now) return "upcoming";

  const elapsedSinceKickoff = now - startTimeMs;
  const pastMaxDuration = elapsedSinceKickoff > MAX_MATCH_DURATION_MS;

  if (score) {
    const stalePackets = now - score.recvTs > STALE_SCORE_MS;
    return stalePackets || pastMaxDuration ? "finished" : "live";
  }

  // Kickoff has passed but no score packet has arrived yet this process —
  // most likely the feed just hasn't caught up (grace window); once well
  // past any plausible match length, call it finished rather than live
  // forever.
  return pastMaxDuration ? "finished" : "live";
}

type CountryEntry = { code: string; flag: string };

// WC-32-style country -> {FIFA-style 3-letter code, flag emoji} lookup,
// keyed on TxLINE's `Participant1`/`Participant2` strings verbatim. Not
// exhaustive — covers a broad footballing-nation slate plus the Friendlies
// test fixtures seen in data/recordings/ (Vietnam, Myanmar, Australia,
// Brazil, ...). Unknown participants fall back to a generated code + ⚽
// (brief-specified fallback) rather than guessing at a flag. England/Wales
// use the plain ⚑ black-flag glyph, not a ZWJ subdivision-flag sequence —
// matches the convention already used in the approved mockup
// (.superpowers/brainstorm/20358-1783435793/content/fixture-page-v4.html,
// "more fixtures" panel: "🏴 ENG – ARG 🇦🇷").
const COUNTRIES: Record<string, CountryEntry> = {
  Argentina: { code: "ARG", flag: "🇦🇷" },
  Australia: { code: "AUS", flag: "🇦🇺" },
  Belgium: { code: "BEL", flag: "🇧🇪" },
  Brazil: { code: "BRA", flag: "🇧🇷" },
  Cameroon: { code: "CMR", flag: "🇨🇲" },
  Canada: { code: "CAN", flag: "🇨🇦" },
  Chile: { code: "CHI", flag: "🇨🇱" },
  Colombia: { code: "COL", flag: "🇨🇴" },
  "Costa Rica": { code: "CRC", flag: "🇨🇷" },
  Croatia: { code: "CRO", flag: "🇭🇷" },
  Denmark: { code: "DEN", flag: "🇩🇰" },
  Ecuador: { code: "ECU", flag: "🇪🇨" },
  Egypt: { code: "EGY", flag: "🇪🇬" },
  England: { code: "ENG", flag: "🏴" },
  France: { code: "FRA", flag: "🇫🇷" },
  Germany: { code: "GER", flag: "🇩🇪" },
  Ghana: { code: "GHA", flag: "🇬🇭" },
  Iran: { code: "IRN", flag: "🇮🇷" },
  Italy: { code: "ITA", flag: "🇮🇹" },
  Japan: { code: "JPN", flag: "🇯🇵" },
  Mexico: { code: "MEX", flag: "🇲🇽" },
  Morocco: { code: "MAR", flag: "🇲🇦" },
  Myanmar: { code: "MYA", flag: "🇲🇲" },
  Netherlands: { code: "NED", flag: "🇳🇱" },
  "New Zealand": { code: "NZL", flag: "🇳🇿" },
  Nigeria: { code: "NGA", flag: "🇳🇬" },
  Norway: { code: "NOR", flag: "🇳🇴" },
  Paraguay: { code: "PAR", flag: "🇵🇾" },
  Peru: { code: "PER", flag: "🇵🇪" },
  Poland: { code: "POL", flag: "🇵🇱" },
  Portugal: { code: "POR", flag: "🇵🇹" },
  Qatar: { code: "QAT", flag: "🇶🇦" },
  "Saudi Arabia": { code: "KSA", flag: "🇸🇦" },
  Senegal: { code: "SEN", flag: "🇸🇳" },
  Serbia: { code: "SRB", flag: "🇷🇸" },
  "South Korea": { code: "KOR", flag: "🇰🇷" },
  Spain: { code: "ESP", flag: "🇪🇸" },
  Switzerland: { code: "SUI", flag: "🇨🇭" },
  Tunisia: { code: "TUN", flag: "🇹🇳" },
  "United States": { code: "USA", flag: "🇺🇸" },
  Uruguay: { code: "URU", flag: "🇺🇾" },
  Vietnam: { code: "VIE", flag: "🇻🇳" },
  Wales: { code: "WAL", flag: "🏴" },
};

export function flag(participant: string): string {
  return COUNTRIES[participant]?.flag ?? "⚽";
}

export function teamCode(participant: string): string {
  return COUNTRIES[participant]?.code ?? participant.slice(0, 3).toUpperCase();
}

// Two hex stops per participant, for the fixture page scorebug's team-color
// edge bars (Task 11 brief: "WC-32 map to two hex stops, fallback
// #2a332c"). This is team-identity DATA (same category as the flag emoji
// table above), not UI chrome, so literal hex is fine here per the Global
// Constraints note — the components consuming it (scorebug.tsx) still use
// CSS-var tokens for everything else. Approximate national-kit colors
// (primary/secondary), not exact Pantone flag specs; good enough for a
// devnet demo edge bar. Same key set as COUNTRIES above (WC-32-style plus
// the Friendlies test fixtures).
export type TeamColorStops = [string, string];

const TEAM_COLORS: Record<string, TeamColorStops> = {
  Argentina: ["#75AADB", "#FFFFFF"],
  Australia: ["#00843D", "#FFCD00"],
  Belgium: ["#000000", "#ED2939"],
  Brazil: ["#FFDF00", "#009C3B"],
  Cameroon: ["#007A5E", "#CE1126"],
  Canada: ["#FF0000", "#FFFFFF"],
  Chile: ["#D52B1E", "#0039A6"],
  Colombia: ["#FCD116", "#003893"],
  "Costa Rica": ["#CE1126", "#002B7F"],
  Croatia: ["#FF0000", "#FFFFFF"],
  Denmark: ["#C60C30", "#FFFFFF"],
  Ecuador: ["#FFDD00", "#034EA2"],
  Egypt: ["#CE1126", "#000000"],
  England: ["#FFFFFF", "#CE1124"],
  France: ["#1E3FAE", "#E02020"],
  Germany: ["#000000", "#DD0000"],
  Ghana: ["#CE1126", "#006B3F"],
  Iran: ["#239F40", "#DA0000"],
  Italy: ["#008C45", "#CD212A"],
  Japan: ["#FFFFFF", "#BC002D"],
  Mexico: ["#006847", "#CE1126"],
  Morocco: ["#C1272D", "#006233"],
  Myanmar: ["#FECB00", "#34B233"],
  Netherlands: ["#FF7900", "#21468B"],
  "New Zealand": ["#000000", "#FFFFFF"],
  Nigeria: ["#008751", "#FFFFFF"],
  Norway: ["#BA0C2F", "#00205B"],
  Paraguay: ["#D52B1E", "#0038A8"],
  Peru: ["#D91023", "#FFFFFF"],
  Poland: ["#FFFFFF", "#DC143C"],
  Portugal: ["#046A38", "#DA020E"],
  Qatar: ["#8D1B3D", "#FFFFFF"],
  "Saudi Arabia": ["#006C35", "#FFFFFF"],
  Senegal: ["#00853F", "#FDEF42"],
  Serbia: ["#C6363C", "#0C4076"],
  "South Korea": ["#CD2E3A", "#0047A0"],
  Spain: ["#C60B1E", "#FFC400"],
  Switzerland: ["#FF0000", "#FFFFFF"],
  Tunisia: ["#E70013", "#FFFFFF"],
  "United States": ["#3C3B6E", "#B22234"],
  Uruguay: ["#5C88DA", "#FFFFFF"],
  Vietnam: ["#DA251D", "#FFFF00"],
  Wales: ["#C8102E", "#00B140"],
};

const TEAM_COLOR_FALLBACK: TeamColorStops = ["#2a332c", "#2a332c"];

export function teamColors(participant: string): TeamColorStops {
  return TEAM_COLORS[participant] ?? TEAM_COLOR_FALLBACK;
}

const STALE_FEED_MS = 90 * 1000;

// STALE badge heuristic per the Task 11 brief: `feedUp === false ||
// Date.now() - lastPacket > 90s`. The brief's "lastPacket" reads as the
// hub's global `Hub.lastPacketTs` (src/server/feedhub.ts), but that field
// is never put on the wire — none of /api/stream's snapshot/score/price/feed
// SSE frames carry it, so nothing in the browser can reach it. The signal
// that *is* shipped to the client and is scoped to this exact fixture is
// `LiveScore.recvTs` (stamped `Date.now()` at ingest for every scores
// packet — see feedhub.ts's `ingestScores`), reaching the browser via the
// SSE-fed ["scores"] TanStack cache. That's what callers pass in here as
// `lastPacketTs`. A fixture with no score packet yet (pre-kickoff, or a
// feed that just hasn't caught up) reads as "not stale" rather than stale —
// there's no packet yet to judge silence against.
export function isFeedStale(
  feedUp: boolean,
  lastPacketTs: number | undefined,
  now: number = Date.now()
): boolean {
  if (!feedUp) return true;
  if (lastPacketTs === undefined) return false;
  return now - lastPacketTs > STALE_FEED_MS;
}

// LIVE FINDING (verified against the recorded devnet scores stream, see
// .superpowers/sdd/progress.md): TxLINE sends *prematch* scores packets too,
// roughly every ~20min, well before kickoff. Those packets stamp a real
// `recvTs`, so feeding that straight into isFeedStale's 90s heuristic makes
// the STALE badge flicker on for fixtures that haven't started — the 90s
// window is far shorter than the ~20min prematch packet cadence, so it reads
// as "stale" between every pair of prematch packets.
//
// The badge is only meaningful once a match is actually live: an upcoming
// fixture isn't "stale", it just hasn't kicked off, and a finished fixture's
// feed going quiet is expected, not a failure. Gating on
// `classifyFixtureStatus`'s output suppresses the flicker without touching
// isFeedStale itself (still correct/tested on its own for the live case).
export function shouldShowStaleBadge(
  status: MatchStatus,
  feedUp: boolean,
  lastPacketTs: number | undefined,
  now: number = Date.now()
): boolean {
  if (status !== "live") return false;
  return isFeedStale(feedUp, lastPacketTs, now);
}

export function sumPooled(markets: Array<{ poolYes: string; poolNo: string }>): bigint {
  return markets.reduce((sum, m) => sum + BigInt(m.poolYes) + BigInt(m.poolNo), 0n);
}

// Picks the market with the largest pool (poolYes + poolNo) — the default
// selection both MarketBoard (src/components/market-row.tsx, a "use client"
// module) and the fixture page's RSC (src/app/fixture/[fixtureId]/page.tsx,
// a Server Component) need to agree on: the RSC seeds PriceChart's initial
// history/goals for whichever pda this picks, and MarketBoard's `selected`
// state defaults to the same pick client-side. Kept here (no "use client",
// no React) rather than in market-row.tsx specifically so both sides can
// import the exact same function — Next.js Server Components cannot call a
// plain function exported from a "use client" module, even a non-JSX one.
export function deepestPool<M extends { poolYes: string; poolNo: string }>(
  markets: M[]
): M | undefined {
  let best: M | undefined;
  let bestPool = -1n;
  for (const m of markets) {
    const pool = BigInt(m.poolYes) + BigInt(m.poolNo);
    if (pool > bestPool) {
      bestPool = pool;
      best = m;
    }
  }
  return best;
}

// Matches src/lib/fpmm.ts's ppm-scale base units (1_000_000 = 1 display
// unit) — same 6-decimal convention as the stake mint (see Task 10 brief:
// `seed_liquidity = 50_000_000` = 50 tokens).
const STAKE_BASE_UNITS = 1_000_000n;

export function formatPooled(raw: bigint): string {
  return (raw / STAKE_BASE_UNITS).toLocaleString("en-US");
}

export function formatClock(seconds: number): string {
  const mm = Math.floor(seconds / 60);
  const ss = Math.floor(seconds % 60);
  return `${mm}:${String(ss).padStart(2, "0")}`;
}

const kickoffFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: "UTC",
  weekday: "short",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

// Hardcodes locale "en-US" and timeZone "UTC" rather than relying on the
// runtime's defaults: this page renders once on the server (Node's default
// locale/timezone) and once more during client hydration (the browser's) —
// if the two ever disagreed, React would throw a hydration mismatch on this
// exact text node. Pinning both removes the ambiguity, at the cost of
// always showing UTC regardless of viewer timezone (acceptable for a
// devnet demo with a global audience).
export function formatKickoff(startTimeMs: number): string {
  return `${kickoffFormatter.format(new Date(startTimeMs))} UTC`;
}
