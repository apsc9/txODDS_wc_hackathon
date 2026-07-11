// Pure helpers shared by the RSC match-list page (src/app/page.tsx) and its
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

export function sumPooled(markets: Array<{ poolYes: string; poolNo: string }>): bigint {
  return markets.reduce((sum, m) => sum + BigInt(m.poolYes) + BigInt(m.poolNo), 0n);
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
