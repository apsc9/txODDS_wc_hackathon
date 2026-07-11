import Link from "next/link";
import type { Fixture, LiveScore } from "@/lib/types";
import {
  flag,
  formatClock,
  formatKickoff,
  formatPooled,
  teamCode,
  type MatchStatus,
} from "@/lib/match-list";

type FixtureCardProps = {
  f: Fixture;
  score?: LiveScore;
  marketCount: number;
  pooled: bigint;
  status: MatchStatus;
};

// Mini scorebug row — one per fixture in a LIVE/UPCOMING/FINISHED section on
// `/`. The full scorebug (team-color edge bars, chart, etc.) is Task 11's
// fixture page; this is deliberately the condensed list-row version from
// the brief.
export function FixtureCard({ f, score, marketCount, pooled, status }: FixtureCardProps) {
  const goals1 = score?.stats["1"];
  const goals2 = score?.stats["2"];
  const scoreText =
    typeof goals1 === "number" && typeof goals2 === "number" ? `${goals1}–${goals2}` : "–";

  return (
    <Link
      href={`/fixture/${f.FixtureId}`}
      prefetch={true}
      className="flex items-center gap-4 border border-[var(--line)] bg-[var(--surface)] px-4 py-3 hover:border-[var(--line-hi)] transition-colors"
    >
      <span className="text-xl leading-none" aria-hidden="true">
        {flag(f.Participant1)}
      </span>
      <span className="font-display font-bold text-lg tracking-wide text-[var(--chalk)] w-10">
        {teamCode(f.Participant1)}
      </span>

      <span className="font-mono-num text-base text-[var(--chalk)] bg-[var(--bg)] border border-[var(--line-hi)] px-3 py-0.5 min-w-[3.5rem] text-center">
        {scoreText}
      </span>

      <span className="font-display font-bold text-lg tracking-wide text-[var(--chalk)] w-10 text-right">
        {teamCode(f.Participant2)}
      </span>
      <span className="text-xl leading-none" aria-hidden="true">
        {flag(f.Participant2)}
      </span>

      <span className="flex-1" />

      <div className="flex flex-col items-end w-24">
        {status === "live" ? (
          <>
            <span className="font-mono-num text-sm text-[var(--gold)]">
              {typeof score?.clockSeconds === "number" ? formatClock(score.clockSeconds) : "—"}
            </span>
            <span className="label text-[var(--gold)]">LIVE</span>
          </>
        ) : status === "finished" ? (
          <span className="label">FT</span>
        ) : (
          <span className="font-mono-num text-sm text-[var(--t3)]">{formatKickoff(f.StartTime)}</span>
        )}
      </div>

      <div className="flex flex-col items-end w-20">
        <span className="font-mono-num text-sm text-[var(--t2)]">{marketCount}</span>
        <span className="label">{marketCount === 1 ? "MARKET" : "MARKETS"}</span>
      </div>

      <div className="flex flex-col items-end w-24">
        <span className="font-mono-num text-sm text-[var(--t2)]">{formatPooled(pooled)}</span>
        <span className="label">POOLED</span>
      </div>
    </Link>
  );
}
