"use client";

import { useEffect } from "react";
import { useQueryClient, type QueryClient } from "@tanstack/react-query";
import type { LiveScore, MarketDTO, PricePoint } from "@/lib/types";

// `markets` is optional for backward compatibility with the pre-Task-9-fix
// frame shape (scores/feedUp only) — when present, it's the authoritative
// full market cache and replaces the ["markets"] cache wholesale, healing
// any staleness accumulated while an EventSource was disconnected.
type SnapshotPayload = {
  scores: Record<number, LiveScore>;
  feedUp: boolean;
  markets?: MarketDTO[];
};
type MarketsPayload = { markets: MarketDTO[] };
type FeedPayload = { up: boolean };
// src/app/api/stream/route.ts's `freshPayload` for a "price" event: pda plus
// the latest history point spread in, or just `{ pda }` if the market has no
// points yet — hence ts/poolPpm/fairPpm are optional here.
type PricePayload = { pda: string; ts?: number; poolPpm?: number; fairPpm?: number | null };

function parse<T>(evt: Event): T | null {
  const raw = (evt as MessageEvent).data;
  try {
    return JSON.parse(raw) as T;
  } catch {
    // A malformed frame must not take the whole stream down — same
    // "isolate one bad message" posture the server side of this pipeline
    // (feedhub.ts's ingestOdds/ingestScores) already takes on parse errors.
    return null;
  }
}

// One EventSource per browser tab, created lazily on first mount and then
// kept open for the tab's lifetime — matches the brief's "module-scope
// singleton" contract. useStream() is only ever mounted once in practice
// (Providers, via StreamBoot below), but the module-scope guard also makes
// this safe under React StrictMode's dev-mode double-invoke of effects.
let source: EventSource | null = null;

// The listener wiring is split out from connect() (which needs a real
// browser EventSource) so vitest can drive these handlers against a fake
// event target + a headless QueryClient — see tests/use-stream.test.ts.
export function attachStreamListeners(
  es: Pick<EventSource, "addEventListener">,
  queryClient: QueryClient,
): void {
  es.addEventListener("snapshot", (evt) => {
    const data = parse<SnapshotPayload>(evt);
    if (!data) return;
    queryClient.setQueryData(["scores"], data.scores);
    queryClient.setQueryData(["feedUp"], data.feedUp);
    if (data.markets) queryClient.setQueryData(["markets"], data.markets);
  });

  es.addEventListener("score", (evt) => {
    const data = parse<LiveScore | null>(evt);
    if (!data) return;
    queryClient.setQueryData<Record<number, LiveScore>>(["scores"], (old) => ({
      ...(old ?? {}),
      [data.fixtureId]: data,
    }));
  });

  es.addEventListener("markets", (evt) => {
    const data = parse<MarketsPayload>(evt);
    if (!data) return;
    queryClient.setQueryData(["markets"], data.markets);
  });

  es.addEventListener("price", (evt) => {
    const data = parse<PricePayload>(evt);
    if (!data || data.ts === undefined || data.poolPpm === undefined) return;
    // Append-only, never create: the server broadcasts an undiffed `price`
    // frame for every Open market each poll tick, so appending here without
    // this guard would materialize a ["history", pda] entry for every open
    // market within one tick of connect. useHistory's later mount for that
    // pda would then find a fresh (staleTime: Infinity) entry already in
    // place — its /api/history queryFn never runs, and the chart shows only
    // the points since tab-open instead of the server's full ring buffer.
    // Only pdas whose backlog useHistory (or the RSC seed) has already
    // loaded may accumulate live ticks.
    if (queryClient.getQueryData(["history", data.pda]) === undefined) return;
    const point: PricePoint = { ts: data.ts, poolPpm: data.poolPpm, fairPpm: data.fairPpm ?? null };
    queryClient.setQueryData<PricePoint[]>(["history", data.pda], (old) => [...(old ?? []), point]);
  });

  es.addEventListener("feed", (evt) => {
    const data = parse<FeedPayload>(evt);
    if (!data) return;
    queryClient.setQueryData(["feedUp"], data.up);
  });
}

function connect(queryClient: QueryClient): EventSource {
  const es = new EventSource("/api/stream");
  attachStreamListeners(es, queryClient);
  return es;
}

export function useStream(): void {
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!source) {
      source = connect(queryClient);
    }
    // Deliberately no cleanup that closes `source`: it's a page-lifetime
    // singleton by design (one EventSource per tab), not scoped to this
    // component's own mount lifecycle.
  }, [queryClient]);
}
