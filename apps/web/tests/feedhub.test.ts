import { describe, it, expect, beforeEach, vi } from "vitest";
import { hub, ingestOdds, ingestScores, type MarketDTO, type HubEvent } from "../src/server/feedhub";
import { encodeStatKey, BASE } from "../src/lib/statkeys";
// Real recorded odds packets (verbatim from the Jul-7 recording) — shared
// with chain.test.ts's poll wiring test, see fixtures.ts for provenance.
import {
  REAL_OVERUNDER_ODDS_LINE,
  REAL_1X2_ODDS_LINE,
  REAL_OU15_FT_ODDS_LINE,
  REAL_OU15_HALF1_ODDS_LINE,
  REAL_1X2_FT_ODDS_LINE_18237038,
  REAL_1X2_HALF1_ODDS_LINE_18237038,
} from "./fixtures";

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

    const entry = hub.consensus.get("18202701:OVERUNDER_PARTICIPANT_GOALS:line=2.5:");
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
    expect(hub.consensus.has("18202701:OVERUNDER_PARTICIPANT_GOALS:line=2.5:")).toBe(false);
  });

  it("keeps full-time and first-half series under distinct consensus keys", () => {
    ingestOdds(REAL_OU15_FT_ODDS_LINE);
    ingestOdds(REAL_OU15_HALF1_ODDS_LINE);

    const ft = hub.consensus.get("18237038:OVERUNDER_PARTICIPANT_GOALS:line=1.5:");
    const half1 = hub.consensus.get("18237038:OVERUNDER_PARTICIPANT_GOALS:line=1.5:half=1");
    expect(ft?.pctByName.over).toBeCloseTo(77.519);
    expect(half1?.pctByName.over).toBeCloseTo(29.958);
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

  it("Subtract+GT0 on the goals pair (home-win) prices from 1X2 consensus", () => {
    ingestOdds(REAL_1X2_ODDS_LINE);
    const homeWinMarket: MarketDTO = {
      fixtureId: 18202701,
      statKeyA: encodeStatKey(0, BASE.GOALS_T1),
      statKeyB: encodeStatKey(0, BASE.GOALS_T2),
      op: "Subtract",
      comparison: "GreaterThan",
      threshold: 0,
    };
    // part1 pct "73.368" -> round(73.368 * 10000)
    expect(hub.fairPpmFor(homeWinMarket)).toBe(733680);
  });

  it("Subtract+GT0 on a NON-goals pair (e.g. yellows) returns null, not mispriced 1X2 consensus — guards feedhub.ts's Subtract branch the same way its Add branch already guards isGoalsPair", () => {
    ingestOdds(REAL_1X2_ODDS_LINE);
    const yellowsDiffMarket: MarketDTO = {
      fixtureId: 18202701,
      statKeyA: encodeStatKey(0, BASE.YELLOWS_T1),
      statKeyB: encodeStatKey(0, BASE.YELLOWS_T2),
      op: "Subtract",
      comparison: "GreaterThan",
      threshold: 0,
    };
    // Before the guard, this fell straight into the 1X2 key lookup (no
    // stat-pair check at all on the Subtract branch) and would have
    // returned 733680 — the same home-win consensus value asserted above —
    // for a market that has nothing to do with match result. That's the
    // discriminating behavior this test pins to null.
    expect(hub.fairPpmFor(yellowsDiffMarket)).toBeNull();
  });

  it("Subtract+GT0 with the goals pair REVERSED (GOALS_T2 − GOALS_T1: away-win) returns null, not home-win consensus — Subtract is directional, unlike Add", () => {
    ingestOdds(REAL_1X2_ODDS_LINE);
    const awayWinMarket: MarketDTO = {
      fixtureId: 18202701,
      statKeyA: encodeStatKey(0, BASE.GOALS_T2),
      statKeyB: encodeStatKey(0, BASE.GOALS_T1),
      op: "Subtract",
      comparison: "GreaterThan",
      threshold: 0,
    };
    // `GOALS_T2 − GOALS_T1 > 0` is an AWAY-win predicate. Its real consensus
    // in this packet is part2 ≈ 7.874%, but an order-blind goals-pair check
    // prices it from pctByName["part1"] (home win) and returns 733680 —
    // ~73.4% for a ~7.9% outcome. Conservative posture: reversed order must
    // fall through to null (no part2 mapping — kept out of scope on purpose).
    expect(hub.fairPpmFor(awayWinMarket)).toBeNull();
  });

  it("FT over-1.5 fair survives a later first-half packet on the same line (no key clobber)", () => {
    const over15Market: MarketDTO = {
      fixtureId: 18237038,
      statKeyA: encodeStatKey(0, BASE.GOALS_T1),
      statKeyB: encodeStatKey(0, BASE.GOALS_T2),
      op: "Add",
      comparison: "GreaterThan",
      threshold: 1,
    };
    ingestOdds(REAL_OU15_FT_ODDS_LINE);
    ingestOdds(REAL_OU15_HALF1_ODDS_LINE);
    // Live bug (France-Spain, Jul 14): both series shared one key, so the
    // chart's fair line sawtoothed 77.5% ↔ 30% as the packets alternated.
    // FT market must keep pricing from the FT series: round(77.519 * 10000).
    expect(hub.fairPpmFor(over15Market)).toBe(775190);
  });

  it("FT home-win fair survives a later first-half 1X2 packet (no key clobber)", () => {
    const homeWinMarket: MarketDTO = {
      fixtureId: 18237038,
      statKeyA: encodeStatKey(0, BASE.GOALS_T1),
      statKeyB: encodeStatKey(0, BASE.GOALS_T2),
      op: "Subtract",
      comparison: "GreaterThan",
      threshold: 0,
    };
    ingestOdds(REAL_1X2_FT_ODDS_LINE_18237038);
    ingestOdds(REAL_1X2_HALF1_ODDS_LINE_18237038);
    // part1 FT pct "40.193" -> round(40.193 * 10000), NOT half=1's 30.741.
    expect(hub.fairPpmFor(homeWinMarket)).toBe(401930);
  });

  it("non-FT (first-half) goals market returns null — consensus mappings are FT-only", () => {
    const over15FirstHalfMarket: MarketDTO = {
      fixtureId: 18237038,
      statKeyA: encodeStatKey(1, BASE.GOALS_T1),
      statKeyB: encodeStatKey(1, BASE.GOALS_T2),
      op: "Add",
      comparison: "GreaterThan",
      threshold: 1,
    };
    ingestOdds(REAL_OU15_FT_ODDS_LINE);
    ingestOdds(REAL_OU15_HALF1_ODDS_LINE);
    // A P1 market must not silently price off the FT lookup key (a half=1
    // mapping is deliberately out of scope — conservative null, same posture
    // as the reversed-Subtract case above).
    expect(hub.fairPpmFor(over15FirstHalfMarket)).toBeNull();
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
