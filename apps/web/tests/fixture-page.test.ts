import { describe, it, expect, afterEach, vi } from "vitest";
import type { MarketDTO } from "../src/lib/types";
import type { Fixture } from "../src/server/txline";

// The page calls ensureStarted() (boot side effects: TxLINE streams + chain
// poller) — mocked to a no-op so this test only exercises the page's own
// hub-snapshot -> MarketBoard-props wiring against the real (test-seeded)
// hub singleton.
vi.mock("../src/server/boot", () => ({ ensureStarted: vi.fn() }));

import { hub } from "../src/server/feedhub";
import FixturePage from "../src/app/fixture/[fixtureId]/page";

function mkMarket(pda: string, fixtureId: number, pool: number): MarketDTO {
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
    poolYes: String(pool),
    poolNo: String(pool),
    seedLiquidity: "0",
    resolveAfterTs: 0,
    finalityDelaySecs: 60,
    voidAfterTs: 0,
    status: "Open",
    yesPpm: 500_000,
    fairPpm: null,
  };
}

function mkFixture(fixtureId: number): Fixture {
  return {
    FixtureId: fixtureId,
    StartTime: Date.now(),
    Participant1: "Spain",
    Participant2: "Belgium",
    Participant1IsHome: true,
    Competition: "Friendlies",
  };
}

afterEach(() => {
  hub.fixtures.clear();
  hub.marketCache.clear();
  hub.history.clear();
  hub.scores.clear();
  hub.goalEvents.clear();
});

describe("fixture page RSC seeding", () => {
  it("seeds MarketBoard with the FULL market cache, not a fixture-filtered subset", async () => {
    // Two fixtures with markets in the hub cache. The fixture page's
    // `initial.markets` becomes initialData for the GLOBAL ["markets"]
    // TanStack key (use-markets.ts) — if it only carries fixture 1's
    // markets, a later client-nav to / or /portfolio finds the cache entry
    // already exists (their own full-cache initialData is a no-op) and
    // renders 0 markets/pool for every other fixture until the next
    // markets-changed SSE diff, which is unbounded on a quiet feed.
    hub.fixtures.set(1, mkFixture(1));
    hub.fixtures.set(2, mkFixture(2));
    const m1 = mkMarket("pda-fixture1", 1, 1_000_000);
    const m2 = mkMarket("pda-fixture2", 2, 9_000_000);
    hub.marketCache.set(m1.pda, m1);
    hub.marketCache.set(m2.pda, m2);

    const el = await FixturePage({ params: Promise.resolve({ fixtureId: "1" }) });
    const markets: MarketDTO[] = el.props.initial.markets;

    expect(markets.map((m) => m.pda).sort()).toEqual(["pda-fixture1", "pda-fixture2"]);
  });

  it("still seeds history for THIS fixture's deepest-pool market, even when another fixture has a deeper pool", async () => {
    hub.fixtures.set(1, mkFixture(1));
    hub.fixtures.set(2, mkFixture(2));
    // Fixture 1 has two markets; its own deepest is pda-f1-deep. Fixture 2's
    // market has a globally deeper pool — a naive deepestPool(fullCache)
    // would pick that one and seed the wrong (or empty) history.
    const f1shallow = mkMarket("pda-f1-shallow", 1, 1_000_000);
    const f1deep = mkMarket("pda-f1-deep", 1, 5_000_000);
    const f2deepest = mkMarket("pda-f2-deepest", 2, 50_000_000);
    for (const m of [f1shallow, f1deep, f2deepest]) hub.marketCache.set(m.pda, m);

    const f1deepPoints = [{ ts: 1, poolPpm: 500_000, fairPpm: 480_000 }];
    hub.history.set("pda-f1-deep", f1deepPoints);
    hub.history.set("pda-f2-deepest", [{ ts: 2, poolPpm: 100_000, fairPpm: null }]);

    const el = await FixturePage({ params: Promise.resolve({ fixtureId: "1" }) });

    expect(el.props.initial.history).toEqual(f1deepPoints);
  });
});
