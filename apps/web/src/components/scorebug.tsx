import type { Fixture, LiveScore } from "@/lib/types";
import {
  classifyFixtureStatus,
  flag,
  formatClock,
  formatKickoff,
  formatPooled,
  shouldShowStaleBadge,
  teamCode,
  teamColors,
} from "@/lib/match-list";

type ScorebugProps = {
  f: Fixture;
  score: LiveScore | undefined;
  pooled: bigint;
  feedUp: boolean;
};

// Approved v4 header (.superpowers/brainstorm/20358-1783435793/content/
// fixture-page-v4.html): team-color edge bars, flags+codes+mono score box,
// gold clock, phase label, total pooled, STALE badge. Purely presentational
// — no hooks of its own — so it stays usable from any parent (currently
// only src/components/market-row.tsx's client `MarketBoard`).
export function Scorebug({ f, score, pooled, feedUp }: ScorebugProps) {
  const status = classifyFixtureStatus(f.StartTime, score, Date.now());
  // Suppressed unless the fixture is actually live — see
  // shouldShowStaleBadge's doc comment in lib/match-list.ts (prematch
  // packets otherwise flicker this badge on hours before kickoff).
  const stale = shouldShowStaleBadge(status, feedUp, score?.recvTs);

  const goals1 = score?.stats["1"];
  const goals2 = score?.stats["2"];
  const scoreText =
    typeof goals1 === "number" && typeof goals2 === "number" ? `${goals1}–${goals2}` : "–";

  const [c1a, c1b] = teamColors(f.Participant1);
  const [c2a, c2b] = teamColors(f.Participant2);

  return (
    <div className="relative flex items-stretch border border-[var(--line-hi)] bg-[var(--surface)]">
      {stale && (
        <span className="label absolute -top-2.5 right-3 border border-[var(--no)] bg-[var(--bg)] px-2 py-0.5 text-[var(--no)]">
          STALE
        </span>
      )}

      <div
        className="w-[5px] shrink-0"
        style={{ background: `linear-gradient(180deg, ${c1a} 50%, ${c1b} 50%)` }}
        aria-hidden="true"
      />

      <div className="flex flex-1 items-center gap-4 px-6 py-4">
        <span className="text-2xl leading-none" aria-hidden="true">
          {flag(f.Participant1)}
        </span>
        <span className="font-display text-3xl font-bold tracking-wide text-[var(--chalk)]">
          {teamCode(f.Participant1)}
        </span>
        <span className="font-mono-num border border-[var(--line-hi)] bg-[var(--bg)] px-4 py-1 text-2xl text-[var(--chalk)]">
          {scoreText}
        </span>
        <span className="font-display text-3xl font-bold tracking-wide text-[var(--chalk)]">
          {teamCode(f.Participant2)}
        </span>
        <span className="text-2xl leading-none" aria-hidden="true">
          {flag(f.Participant2)}
        </span>
      </div>

      {/* Phase label: mockup shows "LIVE · 2ND HALF", but LiveScore (see
          src/lib/types.ts) carries no half/period field — only
          `clockSeconds`, a raw running-clock number with no confirmed
          reset-at-halftime behavior on this feed, and `gameState`, which
          field intel (src/lib/match-list.ts's classifyFixtureStatus doc
          comment) already establishes is unusable ("scheduled" for the
          whole match). Guessing a half from a clock-seconds threshold risks
          a confidently wrong label during stoppage/extra time; per the
          brief's own suggested degradation, this shows plain "LIVE" +
          the running clock instead of fabricating a half. */}
      <div className="flex flex-col justify-center border-l border-dashed border-[var(--line-hi)] px-6">
        {status === "live" ? (
          <>
            <span className="font-mono-num text-lg text-[var(--gold)]">
              {typeof score?.clockSeconds === "number" ? formatClock(score.clockSeconds) : "—"}
            </span>
            <span className="label">LIVE</span>
          </>
        ) : status === "finished" ? (
          <span className="label">FT</span>
        ) : (
          <span className="font-mono-num text-sm text-[var(--t3)]">{formatKickoff(f.StartTime)}</span>
        )}
      </div>

      <div className="flex flex-col justify-center border-l border-dashed border-[var(--line-hi)] px-6">
        <span className="font-mono-num text-sm text-[var(--t2)]">{formatPooled(pooled)}</span>
        <span className="label">TOTAL POOLED</span>
      </div>

      <div
        className="w-[5px] shrink-0"
        style={{ background: `linear-gradient(180deg, ${c2a} 50%, ${c2b} 50%)` }}
        aria-hidden="true"
      />
    </div>
  );
}
