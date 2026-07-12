import { describe, it, expect } from "vitest";
import {
  encodeStatKey,
  decodeStatKey,
  BASE,
  predicateMono,
  predicateHuman,
  canNeedZeroStat,
  marketGroup,
  type PredicateFields,
} from "../src/lib/statkeys";

describe("statkeys: encode/decode", () => {
  it("encodeStatKey(1,7)===1007", () => {
    expect(encodeStatKey(1, 7)).toBe(1007);
  });
  it("decodeStatKey(2004) → {period:2, base:4}", () => {
    const result = decodeStatKey(2004);
    expect(result.period).toBe(2);
    expect(result.base).toBe(4);
  });
});

describe("statkeys: BASE constants", () => {
  it("BASE has correct values", () => {
    expect(BASE.GOALS_T1).toBe(1);
    expect(BASE.GOALS_T2).toBe(2);
    expect(BASE.YELLOWS_T1).toBe(3);
    expect(BASE.YELLOWS_T2).toBe(4);
    expect(BASE.REDS_T1).toBe(5);
    expect(BASE.REDS_T2).toBe(6);
    expect(BASE.CORNERS_T1).toBe(7);
    expect(BASE.CORNERS_T2).toBe(8);
  });
});

describe("statkeys: predicateHuman", () => {
  it("total-goals-over: {statKeyA:1,statKeyB:2,op:Add,comparison:GT,threshold:2} → Over 2.5 total goals", () => {
    const m: PredicateFields = {
      statKeyA: 1,
      statKeyB: 2,
      op: "Add",
      comparison: "GreaterThan",
      threshold: 2,
    };
    const result = predicateHuman(m);
    expect(result).toBe("Over 2.5 total goals");
  });
  it("home win: {1,2,Subtract,GT,0} + (France,Brazil) → France to win", () => {
    const m: PredicateFields = {
      statKeyA: 1,
      statKeyB: 2,
      op: "Subtract",
      comparison: "GreaterThan",
      threshold: 0,
    };
    const result = predicateHuman(m, "France", "Brazil");
    expect(result).toBe("France to win");
  });
  it("home win without team names falls back to Home", () => {
    const m: PredicateFields = {
      statKeyA: 1,
      statKeyB: 2,
      op: "Subtract",
      comparison: "GreaterThan",
      threshold: 0,
    };
    const result = predicateHuman(m);
    expect(result).toBe("Home to win");
  });
});

describe("statkeys: predicateMono", () => {
  it("total-goals-over mono contains > 2", () => {
    const m: PredicateFields = {
      statKeyA: 1,
      statKeyB: 2,
      op: "Add",
      comparison: "GreaterThan",
      threshold: 2,
    };
    const result = predicateMono(m);
    expect(result).toContain("> 2");
  });
  it("total-goals-over mono contains GOALS and FT", () => {
    const m: PredicateFields = {
      statKeyA: 1,
      statKeyB: 2,
      op: "Add",
      comparison: "GreaterThan",
      threshold: 2,
    };
    const result = predicateMono(m);
    expect(result).toContain("GOALS");
    expect(result).toContain("FT");
  });
});

describe("statkeys: canNeedZeroStat", () => {
  it("canNeedZeroStat false for GreaterThan", () => {
    const m: PredicateFields = {
      statKeyA: 1,
      statKeyB: 2,
      op: "Add",
      comparison: "GreaterThan",
      threshold: 2,
    };
    expect(canNeedZeroStat(m)).toBe(false);
  });
  it("canNeedZeroStat true for GreaterThan with threshold 0", () => {
    const m: PredicateFields = {
      statKeyA: 1,
      statKeyB: 2,
      op: "Subtract",
      comparison: "GreaterThan",
      threshold: 0,
    };
    expect(canNeedZeroStat(m)).toBe(true);
  });
  it("canNeedZeroStat true for EqualTo", () => {
    const m: PredicateFields = {
      statKeyA: 1,
      statKeyB: null,
      op: null,
      comparison: "EqualTo",
      threshold: 0,
    };
    expect(canNeedZeroStat(m)).toBe(true);
  });
  it("canNeedZeroStat true for LessThan", () => {
    const m: PredicateFields = {
      statKeyA: 1,
      statKeyB: null,
      op: null,
      comparison: "LessThan",
      threshold: 2,
    };
    expect(canNeedZeroStat(m)).toBe(true);
  });
});

describe("statkeys: marketGroup", () => {
  it("goals-over -> GOALS", () => {
    const m: PredicateFields = {
      statKeyA: 1,
      statKeyB: 2,
      op: "Add",
      comparison: "GreaterThan",
      threshold: 2,
    };
    expect(marketGroup(m)).toBe("GOALS");
  });
  it("corners-over -> CORNERS", () => {
    const m: PredicateFields = {
      statKeyA: 7,
      statKeyB: 8,
      op: "Add",
      comparison: "GreaterThan",
      threshold: 8,
    };
    expect(marketGroup(m)).toBe("CORNERS");
  });
  it("yellows-over -> CARDS", () => {
    const m: PredicateFields = {
      statKeyA: 3,
      statKeyB: 4,
      op: "Add",
      comparison: "GreaterThan",
      threshold: 3,
    };
    expect(marketGroup(m)).toBe("CARDS");
  });
  it("reds-over -> CARDS", () => {
    const m: PredicateFields = {
      statKeyA: 5,
      statKeyB: 6,
      op: "Add",
      comparison: "GreaterThan",
      threshold: 0,
    };
    expect(marketGroup(m)).toBe("CARDS");
  });
  it("home-win (goals subtract) -> RESULT even though statKeyA is a goals key", () => {
    const m: PredicateFields = {
      statKeyA: 1,
      statKeyB: 2,
      op: "Subtract",
      comparison: "GreaterThan",
      threshold: 0,
    };
    expect(marketGroup(m)).toBe("RESULT");
  });
});
