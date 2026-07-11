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

// `initial` only needs to be supplied by whichever caller first hydrates the
// page (the homepage's <MatchList>) — the query key ["markets"] is global,
// not per-fixture, so a later caller (e.g. a fixture detail page) can call
// `useMarkets(fixtureId)` with no `initial` and just read/filter whatever is
// already cached; `initialData` is a no-op once the cache entry exists.
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
// badge (see src/lib/match-list.ts's `isFeedStale`).
export function useFeedUp(initial: boolean): boolean {
  const { data } = useQuery({
    queryKey: ["feedUp"],
    queryFn: () => initial,
    initialData: initial,
    staleTime: Infinity,
  });
  return data;
}
