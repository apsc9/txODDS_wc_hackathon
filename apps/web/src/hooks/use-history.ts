"use client";

import { useQuery } from "@tanstack/react-query";
import type { GoalEvent, PricePoint } from "@/lib/types";

// useHistory — seeds the ["history", pda] TanStack cache from
// /api/history?market=<pda> (Task 13 brief's "initial" half of the
// interface). The "SSE price appends" half is already wired: useStream()'s
// "price" listener (src/hooks/use-stream.ts) calls
// `setQueryData<PricePoint[]>(["history", pda], ...)` on the exact same key,
// so once this query has populated the cache, every subsequent price tick
// just appends to it — no polling, no refetch. `staleTime: Infinity` mirrors
// src/hooks/use-markets.ts's convention: this query is never considered
// stale, so switching `enabled` back on for an already-fetched pda (e.g.
// re-selecting a market) doesn't trigger a redundant refetch.
//
// `initial` mirrors use-markets.ts's RSC-seeding pattern: the fixture page
// (a Server Component, reading `hub` directly — see src/app/fixture/
// [fixtureId]/page.tsx) already knows which market is selected by default
// (fixtureDefaultMarket) and can read its history straight out of the ring buffer
// with no HTTP round trip, so that one market's first paint needs no client
// fetch at all — this is what makes the chart's SSR markup show real data
// instead of an empty shell. Only ever pass `initial` for the pda it was
// actually fetched for; passing it for a different pda would silently seed
// the wrong market's history (callers must guard this — see
// components/market-row.tsx's `initialSelectedPda` check).
export function useHistory(pda: string | undefined, initial?: PricePoint[]) {
  return useQuery({
    queryKey: ["history", pda],
    queryFn: async (): Promise<PricePoint[]> => {
      const res = await fetch(`/api/history?market=${pda}`);
      if (!res.ok) throw new Error("failed to fetch history");
      const data = (await res.json()) as { points: PricePoint[]; goals: GoalEvent[] };
      return data.points;
    },
    initialData: initial,
    enabled: !!pda,
    staleTime: Infinity,
  });
}

// useGoals — /api/history's `goals` field, keyed by fixtureId (goals belong
// to the fixture, not any one market — see that route's comment). This is
// the "history-embedded events" source the Task 13 brief asks about:
// hub.goalEvents is populated by feedhub.ts's score-diff detection
// server-side and carries real ts/clockSeconds, so an initial fetch here
// gets accurately timestamped markers for anything scored before mount.
// There's no SSE "goal" event type, so a goal scored *after* mount wouldn't
// otherwise show up until something re-fetches this key — PriceChart
// (the sole caller) covers that by invalidating this query when the live
// ["scores"] cache reports a higher goal tally for this fixture (event-driven
// off the "score" SSE stream that's already flowing, not a timer/poll).
export function useGoals(
  fixtureId: number | undefined,
  pda: string | undefined,
  initial?: GoalEvent[]
) {
  return useQuery({
    queryKey: ["goals", fixtureId],
    queryFn: async (): Promise<GoalEvent[]> => {
      const res = await fetch(`/api/history?market=${pda}`);
      if (!res.ok) throw new Error("failed to fetch goals");
      const data = (await res.json()) as { points: PricePoint[]; goals: GoalEvent[] };
      return data.goals;
    },
    initialData: initial,
    enabled: !!fixtureId && !!pda,
    staleTime: Infinity,
  });
}
