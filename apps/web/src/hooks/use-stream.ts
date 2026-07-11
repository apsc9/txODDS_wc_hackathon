"use client";

import { useEffect } from "react";
import { useQueryClient, type QueryClient } from "@tanstack/react-query";
import type { LiveScore, MarketDTO, PricePoint } from "@/lib/types";

type SnapshotPayload = { scores: Record<number, LiveScore>; feedUp: boolean };
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

function connect(queryClient: QueryClient): EventSource {
  const es = new EventSource("/api/stream");

  es.addEventListener("snapshot", (evt) => {
    const data = parse<SnapshotPayload>(evt);
    if (!data) return;
    queryClient.setQueryData(["scores"], data.scores);
    queryClient.setQueryData(["feedUp"], data.feedUp);
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
    const point: PricePoint = { ts: data.ts, poolPpm: data.poolPpm, fairPpm: data.fairPpm ?? null };
    queryClient.setQueryData<PricePoint[]>(["history", data.pda], (old) => [...(old ?? []), point]);
  });

  es.addEventListener("feed", (evt) => {
    const data = parse<FeedPayload>(evt);
    if (!data) return;
    queryClient.setQueryData(["feedUp"], data.up);
  });

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
