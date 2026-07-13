import { describe, it, expect, beforeEach } from "vitest";
import { QueryClient } from "@tanstack/react-query";
import { attachStreamListeners } from "../src/hooks/use-stream";
import type { MarketDTO, PricePoint } from "../src/lib/types";

// Drives the SSE listener wiring against a fake event target + a headless
// QueryClient (no DOM, no EventSource) — the exact setQueryData behavior the
// SSE-vs-RSC invariant rests on (see src/hooks/use-markets.ts's doc comment).

function fakeEventSource() {
  const listeners = new Map<string, (evt: MessageEvent) => void>();
  const es = {
    addEventListener(type: string, fn: (evt: MessageEvent) => void) {
      listeners.set(type, fn);
    },
  } as unknown as Pick<EventSource, "addEventListener">;
  return {
    es,
    emit(type: string, payload: unknown) {
      listeners.get(type)?.({ data: JSON.stringify(payload) } as MessageEvent);
    },
  };
}

function mkMarket(pda: string, fixtureId: number): MarketDTO {
  return {
    pda,
    creator: "creator",
    marketId: "1",
    fixtureId,
    statKeyA: 1,
    statKeyB: 2,
    op: "Add",
    comparison: "GreaterThan",
    threshold: 2,
    mint: "mint",
    poolYes: "1000000",
    poolNo: "1000000",
    seedLiquidity: "0",
    resolveAfterTs: 0,
    finalityDelaySecs: 60,
    voidAfterTs: 0,
    status: "Open",
    yesPpm: 500_000,
    fairPpm: null,
  };
}

describe("attachStreamListeners", () => {
  let queryClient: QueryClient;
  let stream: ReturnType<typeof fakeEventSource>;

  beforeEach(() => {
    queryClient = new QueryClient();
    stream = fakeEventSource();
    attachStreamListeners(stream.es, queryClient);
  });

  describe("price frames", () => {
    it("does NOT create a ['history', pda] cache entry for a pda never fetched", () => {
      // The server broadcasts an undiffed `price` frame for every Open
      // market every poll tick. Appending unconditionally CREATES cache
      // entries for all of them within ~1 tick of connect — so when
      // useHistory later mounts for a newly selected market, the (fresh,
      // staleTime Infinity) entry already exists, its /api/history queryFn
      // never runs, and the chart shows only points since tab-open instead
      // of the server's 2000-point ring buffer.
      stream.emit("price", { pda: "pda-unknown", ts: 1, poolPpm: 500_000, fairPpm: null });

      expect(queryClient.getQueryData(["history", "pda-unknown"])).toBeUndefined();
    });

    it("still appends to a ['history', pda] entry that already exists", () => {
      const seeded: PricePoint[] = [{ ts: 1, poolPpm: 400_000, fairPpm: null }];
      queryClient.setQueryData(["history", "pda-known"], seeded);

      stream.emit("price", { pda: "pda-known", ts: 2, poolPpm: 500_000, fairPpm: 480_000 });

      expect(queryClient.getQueryData(["history", "pda-known"])).toEqual([
        { ts: 1, poolPpm: 400_000, fairPpm: null },
        { ts: 2, poolPpm: 500_000, fairPpm: 480_000 },
      ]);
    });
  });

  describe("snapshot frames", () => {
    it("replaces a stale ['markets'] cache when the snapshot carries markets (reconnect recovery)", () => {
      queryClient.setQueryData(["markets"], [mkMarket("pda-stale", 1)]);
      const fresh = [mkMarket("pda-1", 1), mkMarket("pda-2", 2)];

      stream.emit("snapshot", { scores: {}, feedUp: true, markets: fresh });

      expect(queryClient.getQueryData(["markets"])).toEqual(fresh);
    });

    it("tolerates a snapshot without markets (old frame shape): scores/feedUp update, markets untouched", () => {
      const existing = [mkMarket("pda-existing", 1)];
      queryClient.setQueryData(["markets"], existing);

      stream.emit("snapshot", { scores: {}, feedUp: false });

      expect(queryClient.getQueryData(["markets"])).toEqual(existing);
      expect(queryClient.getQueryData(["feedUp"])).toBe(false);
    });
  });
});
