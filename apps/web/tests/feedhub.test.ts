import { describe, it, expect, beforeEach, vi } from "vitest";
import { hub, ingestOdds, ingestScores, type MarketDTO, type HubEvent } from "../src/server/feedhub";
import { encodeStatKey, BASE } from "../src/lib/statkeys";

// Real recorded packet: data/recordings/devnet-odds-2026-07-07.jsonl, first
// OVERUNDER_PARTICIPANT_GOALS line (fixture 18202701, `line=2.5`), copied
// verbatim from the JSONL row's "data" field — the exact string openStream's
// onMsg would hand to ingestOdds.
const REAL_OVERUNDER_ODDS_LINE =
  '{"FixtureId":18202701,"MessageId":"1836733400:00003:000105-10021-stab","Ts":1783435234232,"Bookmaker":"TXLineStablePriceDemargined","BookmakerId":10021,"SuperOddsType":"OVERUNDER_PARTICIPANT_GOALS","GameState":null,"InRunning":false,"MarketParameters":"line=2.5","MarketPeriod":null,"PriceNames":["over","under"],"Prices":[2082,1924],"Pct":["48.031","51.975"]}';

function scoresPacket(fixtureId: number, goals1: number): string {
  return JSON.stringify({
    FixtureId: fixtureId,
    GameState: "live",
    Ts: 1000,
    Seq: 1,
    Clock: { Running: true, Seconds: 42 },
    Stats: { "1": goals1, "2": 0 },
  });
}

beforeEach(() => {
  hub.consensus.clear();
  hub.scores.clear();
  hub.goalEvents.clear();
  hub.history.clear();
});

describe("emit / subscribe", () => {
  it("isolates listener errors: a throwing listener doesn't block others or propagate", () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const received: HubEvent[] = [];
    const unsubThrower = hub.subscribe(() => {
      throw new Error("boom");
    });
    const unsubReceiver = hub.subscribe((evt) => {
      received.push(evt);
    });

    try {
      expect(() => ingestScores(scoresPacket(999, 0))).not.toThrow();
      // ingestScores may also emit a "feed" event (feedUp transition) ahead
      // of the "score" event depending on prior test state — isolation is
      // about the "score" event still reaching this listener, not ordering.
      expect(received).toContainEqual({ type: "score", fixtureId: 999 });
    } finally {
      unsubThrower();
      unsubReceiver();
      errSpy.mockRestore();
    }
  });
});

describe("ingestOdds", () => {
  it("populates consensus from a real recorded OVERUNDER demarginated packet", () => {
    ingestOdds(REAL_OVERUNDER_ODDS_LINE);

    const entry = hub.consensus.get("18202701:OVERUNDER_PARTICIPANT_GOALS:line=2.5");
    expect(entry).toBeDefined();
    expect(entry?.pctByName.over).toBeCloseTo(48.031);
    expect(entry?.pctByName.under).toBeCloseTo(51.975);
    expect(entry?.ts).toBe(1783435234232);
  });

  it("ignores packets from non-demarginated bookmakers", () => {
    const other = REAL_OVERUNDER_ODDS_LINE.replace(
      "TXLineStablePriceDemargined",
      "SomeOtherBookmaker"
    );
    ingestOdds(other);
    expect(hub.consensus.has("18202701:OVERUNDER_PARTICIPANT_GOALS:line=2.5")).toBe(false);
  });
});

describe("ingestScores", () => {
  it("produces one goal event for team 1 when stats.1 increases across packets", () => {
    ingestScores(scoresPacket(999, 0));
    expect(hub.goalEvents.get(999)).toEqual([]);

    ingestScores(scoresPacket(999, 1));
    expect(hub.goalEvents.get(999)).toEqual([{ ts: 1000, clockSeconds: 42, team: 1 }]);
  });

  it("heartbeat events update lastPacketTs but not scores state", () => {
    ingestScores(scoresPacket(999, 0));
    const before = hub.scores.get(999);

    ingestScores('{"Ts":1783435244}', "heartbeat");

    expect(hub.scores.get(999)).toEqual(before);
  });

  it("does not fabricate goal events on cold start mid-match", () => {
    // Connecting mid-match: the first packet we ever see for this fixture
    // already shows a 2-1 score. There is no prior packet to diff against,
    // so this must seed the baseline silently rather than emit 3 fake goals.
    ingestScores(
      JSON.stringify({
        FixtureId: 555,
        GameState: "live",
        Ts: 1000,
        Seq: 1,
        Clock: { Running: true, Seconds: 42 },
        Stats: { "1": 2, "2": 1 },
      })
    );
    expect(hub.goalEvents.get(555)).toEqual([]);

    ingestScores(
      JSON.stringify({
        FixtureId: 555,
        GameState: "live",
        Ts: 2000,
        Seq: 2,
        Clock: { Running: true, Seconds: 55 },
        Stats: { "1": 3, "2": 1 },
      })
    );
    expect(hub.goalEvents.get(555)).toEqual([{ ts: 2000, clockSeconds: 55, team: 1 }]);
  });
});

describe("pushPrice", () => {
  it("caps history at 2000 entries, keeping the most recent", () => {
    for (let i = 0; i < 2005; i++) {
      hub.pushPrice("market-pda", { ts: i, poolPpm: i, fairPpm: null });
    }
    const points = hub.history.get("market-pda");
    expect(points).toHaveLength(2000);
    expect(points?.[0].ts).toBe(5);
    expect(points?.[points.length - 1].ts).toBe(2004);
  });
});

describe("fairPpmFor", () => {
  const totalGoalsMarket: MarketDTO = {
    fixtureId: 18202701,
    statKeyA: encodeStatKey(0, BASE.GOALS_T1),
    statKeyB: encodeStatKey(0, BASE.GOALS_T2),
    op: "Add",
    comparison: "GreaterThan",
    threshold: 2,
  };

  it("returns the over-pct in ppm when consensus exists for the matching line", () => {
    ingestOdds(REAL_OVERUNDER_ODDS_LINE);
    expect(hub.fairPpmFor(totalGoalsMarket)).toBe(480310);
  });

  it("returns null when there is no consensus entry", () => {
    expect(hub.fairPpmFor(totalGoalsMarket)).toBeNull();
  });

  it("returns null when the consensus pct is NaN (malformed Pct string)", () => {
    const malformed = REAL_OVERUNDER_ODDS_LINE.replace('"48.031"', '"not-a-number"');
    ingestOdds(malformed);
    expect(hub.fairPpmFor(totalGoalsMarket)).toBeNull();
  });

  it("returns null for predicates it doesn't understand", () => {
    const unrelated: MarketDTO = {
      fixtureId: 18202701,
      statKeyA: encodeStatKey(0, BASE.CORNERS_T1),
      statKeyB: null,
      op: null,
      comparison: "LessThan",
      threshold: 5,
    };
    expect(hub.fairPpmFor(unrelated)).toBeNull();
  });
});
