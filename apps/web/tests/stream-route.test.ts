import { describe, it, expect, afterEach, vi } from "vitest";
import type { MarketDTO } from "../src/lib/types";

// /api/stream's opening `snapshot` frame must carry the full market cache
// alongside scores/feedUp: an EventSource reconnect replays snapshot (never
// the missed `markets` diffs), so without markets in it a reconnecting tab
// keeps a stale ["markets"] cache until the next markets-changed diff —
// unbounded on a quiet feed. ensureStarted is mocked to a no-op (boot side
// effects are covered by boot.test.ts); the hub singleton is seeded directly.
vi.mock("../src/server/boot", async () => {
  const actual = await vi.importActual<typeof import("../src/server/boot")>("../src/server/boot");
  return { ...actual, ensureStarted: vi.fn() };
});

import { hub } from "../src/server/feedhub";
import { GET } from "../src/app/api/stream/route";

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

afterEach(() => {
  hub.marketCache.clear();
  hub.scores.clear();
});

async function readSnapshotData(): Promise<Record<string, unknown>> {
  const ac = new AbortController();
  const res = await GET(new Request("http://test/api/stream", { signal: ac.signal }));
  const reader = res.body!.getReader();
  try {
    const { value } = await reader.read();
    const text = new TextDecoder().decode(value);
    const match = text.match(/^event: snapshot\ndata: (.+)\n\n/);
    expect(match).not.toBeNull();
    return JSON.parse(match![1]);
  } finally {
    ac.abort();
    reader.releaseLock();
  }
}

describe("GET /api/stream snapshot frame", () => {
  it("carries the full market cache so a reconnect replaces stale client state", async () => {
    const m1 = mkMarket("pda-1", 1);
    const m2 = mkMarket("pda-2", 2);
    hub.marketCache.set(m1.pda, m1);
    hub.marketCache.set(m2.pda, m2);

    const data = await readSnapshotData();

    expect(data.markets).toEqual([m1, m2]);
  });

  it("keeps the existing scores/feedUp fields (additive, backward-compatible frame shape)", async () => {
    const data = await readSnapshotData();

    expect(data).toHaveProperty("scores");
    expect(data).toHaveProperty("feedUp");
  });
});
