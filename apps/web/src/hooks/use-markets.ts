"use client";

import { useQuery } from "@tanstack/react-query";
import type { Fixture, LiveScore, MarketDTO } from "@/lib/types";

// All three hooks below share one shape: seed the TanStack cache with the
// RSC-rendered snapshot via `initialData`, then never refetch — `staleTime:
// Infinity` means the query is always considered fresh, so no fetch is ever
// triggered on mount/refocus/reconnect. The only thing that ever updates
// these caches again is useStream()'s setQueryData calls (SSE push). This is
// what "no refetchInterval, SSE-driven" (Global Constraints: no browser
// polling loops) means in practice for these three keys. `queryFn` is only
// a type-satisfying fallback for the (in practice unreachable while a tab
// stays open) case where the cache entry gets garbage-collected and remounted
// — it does no network I/O, just returns the closed-over initial snapshot.

export function useFixtures(initial: Fixture[]) {
  return useQuery({
    queryKey: ["fixtures"],
    queryFn: () => initial,
    initialData: initial,
    staleTime: Infinity,
  });
}

export function useScores(initial: Record<number, LiveScore>) {
  return useQuery({
    queryKey: ["scores"],
    queryFn: () => initial,
    initialData: initial,
    staleTime: Infinity,
  });
}

// The query key ["markets"] is GLOBAL, not per-fixture — so any `initial`
// passed here must always be the FULL market cache, never a fixture-filtered
// subset. `initialData` is a no-op once the cache entry exists, which means
// whichever page hydrates first wins: if a hard-loaded fixture page seeded
// only its own markets, a later client-nav to `/` or `/portfolio` would find
// the entry already present, their full-cache initialData would be ignored,
// and every other fixture would render 0 markets (and portfolio would drop
// tickets) until the next markets-changed SSE diff. All seeders (home,
// portfolio, fixture RSCs) therefore pass Array.from(hub.marketCache.values())
// wholesale; fixture-scoped display comes from the `fixtureId` filter below.
export function useMarkets(fixtureId?: number, initial: MarketDTO[] = []): MarketDTO[] {
  const { data } = useQuery({
    queryKey: ["markets"],
    queryFn: () => initial,
    initialData: initial,
    staleTime: Infinity,
  });
  return fixtureId === undefined ? data : data.filter((m) => m.fixtureId === fixtureId);
}

// Global feed-health flag, pushed by useStream()'s "snapshot"/"feed" SSE
// listeners (src/hooks/use-stream.ts). Used by the fixture page's STALE
// badge (see src/lib/match-list.ts's `shouldShowStaleBadge`).
export function useFeedUp(initial: boolean): boolean {
  const { data } = useQuery({
    queryKey: ["feedUp"],
    queryFn: () => initial,
    initialData: initial,
    staleTime: Infinity,
  });
  return data;
}
