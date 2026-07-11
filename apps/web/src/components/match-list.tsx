"use client";

import { useMemo } from "react";
import type { Fixture, LiveScore, MarketDTO } from "@/lib/types";
import { useFixtures, useMarkets, useScores } from "@/hooks/use-markets";
import { classifyFixtureStatus, sumPooled, type MatchStatus } from "@/lib/match-list";
import { FixtureCard } from "@/components/fixture-card";

export type MatchListInitial = {
  fixtures: Fixture[];
  scores: Record<number, LiveScore>;
  markets: MarketDTO[];
};

const SECTIONS: Array<{ status: MatchStatus; title: string }> = [
  { status: "live", title: "LIVE" },
  { status: "upcoming", title: "UPCOMING" },
  { status: "finished", title: "FINISHED" },
];

// Client hydration boundary for `/`: reads the SSE-fed TanStack caches
// (seeded with the RSC page's `initial` snapshot, then kept current by
// useStream() — see src/hooks/use-markets.ts and src/hooks/use-stream.ts)
// and re-buckets fixtures into LIVE/UPCOMING/FINISHED on every render, so a
// fixture moves sections live (e.g. UPCOMING -> LIVE the moment its first
// score packet lands) without a reload.
export function MatchList({ initial }: { initial: MatchListInitial }) {
  const { data: fixtures } = useFixtures(initial.fixtures);
  const { data: scores } = useScores(initial.scores);
  const markets = useMarkets(undefined, initial.markets);

  const marketsByFixture = useMemo(() => {
    const map = new Map<number, MarketDTO[]>();
    for (const m of markets) {
      const list = map.get(m.fixtureId);
      if (list) list.push(m);
      else map.set(m.fixtureId, [m]);
    }
    return map;
  }, [markets]);

  const buckets: Record<MatchStatus, Fixture[]> = { live: [], upcoming: [], finished: [] };
  const now = Date.now();
  for (const f of fixtures) {
    const status = classifyFixtureStatus(f.StartTime, scores[f.FixtureId], now);
    buckets[status].push(f);
  }
  buckets.live.sort((a, b) => a.StartTime - b.StartTime);
  buckets.upcoming.sort((a, b) => a.StartTime - b.StartTime);
  buckets.finished.sort((a, b) => b.StartTime - a.StartTime);

  if (fixtures.length === 0) {
    return <p className="text-[var(--t3)] text-sm">No fixtures in range right now.</p>;
  }

  return (
    <div className="flex flex-col gap-8">
      {SECTIONS.map(({ status, title }) => {
        const list = buckets[status];
        if (list.length === 0) return null;
        return (
          <section key={status}>
            <h2 className="label mb-3">{title}</h2>
            <div className="flex flex-col gap-2">
              {list.map((f) => {
                const ms = marketsByFixture.get(f.FixtureId) ?? [];
                return (
                  <FixtureCard
                    key={f.FixtureId}
                    f={f}
                    score={scores[f.FixtureId]}
                    marketCount={ms.length}
                    pooled={sumPooled(ms)}
                    status={status}
                  />
                );
              })}
            </div>
          </section>
        );
      })}
    </div>
  );
}
