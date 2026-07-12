import { describe, it, expect } from "vitest";
import {
  classifyFixtureStatus,
  flag,
  teamCode,
  teamColors,
  isFeedStale,
  shouldShowStaleBadge,
  sumPooled,
  formatPooled,
  formatClock,
  formatKickoff,
} from "../src/lib/match-list";

const HOUR = 60 * 60 * 1000;
const MIN = 60 * 1000;

describe("classifyFixtureStatus", () => {
  it("classifies a fixture with a future StartTime as upcoming", () => {
    const now = 1_000_000;
    expect(classifyFixtureStatus(now + HOUR, undefined, now)).toBe("upcoming");
  });

  it("classifies a started fixture with fresh score packets as live", () => {
    const now = 1_000_000;
    const startTime = now - 30 * MIN;
    const score = { recvTs: now - 5000 };
    expect(classifyFixtureStatus(startTime, score, now)).toBe("live");
  });

  it("classifies a started fixture with no score packets yet as live (feed catch-up grace window)", () => {
    const now = 1_000_000;
    const startTime = now - 5 * MIN;
    expect(classifyFixtureStatus(startTime, undefined, now)).toBe("live");
  });

  it("classifies a fixture as finished once its last score packet has gone stale", () => {
    const now = 1_000_000;
    const startTime = now - 90 * MIN;
    const score = { recvTs: now - 25 * MIN }; // > 20min stale threshold
    expect(classifyFixtureStatus(startTime, score, now)).toBe("finished");
  });

  it("classifies a fixture as finished once past the max match duration, even with recent packets", () => {
    const now = 1_000_000;
    const startTime = now - 4 * HOUR; // > 3h max duration
    const score = { recvTs: now - 1000 };
    expect(classifyFixtureStatus(startTime, score, now)).toBe("finished");
  });

  it("classifies a started fixture with no score packets ever as finished once well past match length", () => {
    const now = 1_000_000;
    const startTime = now - 4 * HOUR;
    expect(classifyFixtureStatus(startTime, undefined, now)).toBe("finished");
  });
});

describe("flag / teamCode", () => {
  it("resolves a known WC-32-table country to its flag and code", () => {
    expect(flag("France")).toBe("🇫🇷");
    expect(teamCode("France")).toBe("FRA");
  });

  it("falls back to ⚽ and a generated 3-letter code for an unknown participant", () => {
    expect(flag("Atlantis")).toBe("⚽");
    expect(teamCode("Atlantis")).toBe("ATL");
  });
});

describe("teamColors", () => {
  it("resolves a known WC-32-table country to its two-hex-stop pair", () => {
    expect(teamColors("France")).toEqual(["#1E3FAE", "#E02020"]);
    expect(teamColors("Brazil")).toEqual(["#FFDF00", "#009C3B"]);
  });

  it("falls back to #2a332c/#2a332c for an unknown participant", () => {
    expect(teamColors("Atlantis")).toEqual(["#2a332c", "#2a332c"]);
  });
});

describe("isFeedStale", () => {
  it("is stale whenever feedUp is false, regardless of lastPacketTs", () => {
    expect(isFeedStale(false, undefined, 1_000_000)).toBe(true);
    expect(isFeedStale(false, 999_999, 1_000_000)).toBe(true);
  });

  it("is not stale when feedUp is true and no packet has arrived yet", () => {
    expect(isFeedStale(true, undefined, 1_000_000)).toBe(false);
  });

  it("is not stale when feedUp is true and the last packet is within 90s", () => {
    const now = 1_000_000;
    expect(isFeedStale(true, now - 89_000, now)).toBe(false);
  });

  it("is stale when feedUp is true but the last packet is older than 90s", () => {
    const now = 1_000_000;
    expect(isFeedStale(true, now - 91_000, now)).toBe(true);
  });
});

describe("shouldShowStaleBadge", () => {
  // LIVE FINDING: TxLINE sends prematch scores packets ~20min apart, so a
  // fixture that hasn't kicked off yet still has a `recvTs` — feeding that
  // straight into isFeedStale's 90s heuristic makes the badge flicker on
  // between those prematch packets, hours before kickoff. Gating on
  // `status === "live"` (classifyFixtureStatus) suppresses that: only a
  // fixture that has actually started can ever show STALE.
  it("suppresses STALE for an upcoming fixture even with an old prematch packet", () => {
    const now = 1_000_000;
    // status is "upcoming" whenever startTime is in the future, regardless
    // of score/recvTs age.
    expect(shouldShowStaleBadge("upcoming", true, now - 25 * 60 * 1000, now)).toBe(false);
    expect(shouldShowStaleBadge("upcoming", false, now - 25 * 60 * 1000, now)).toBe(false);
  });

  it("suppresses STALE for a finished fixture regardless of feed state", () => {
    const now = 1_000_000;
    expect(shouldShowStaleBadge("finished", false, now - 25 * 60 * 1000, now)).toBe(false);
    expect(shouldShowStaleBadge("finished", true, undefined, now)).toBe(false);
  });

  it("shows STALE for a live fixture whose feed is down", () => {
    const now = 1_000_000;
    expect(shouldShowStaleBadge("live", false, now - 5000, now)).toBe(true);
  });

  it("shows STALE for a live fixture whose last packet is older than 90s", () => {
    const now = 1_000_000;
    expect(shouldShowStaleBadge("live", true, now - 91_000, now)).toBe(true);
  });

  it("does not show STALE for a live fixture with a fresh packet and feed up", () => {
    const now = 1_000_000;
    expect(shouldShowStaleBadge("live", true, now - 5000, now)).toBe(false);
  });
});

describe("sumPooled / formatPooled", () => {
  it("sums poolYes + poolNo across markets as bigint", () => {
    const markets = [
      { poolYes: "1000000", poolNo: "2000000" },
      { poolYes: "500000", poolNo: "500000" },
    ];
    expect(sumPooled(markets)).toBe(4_000_000n);
  });

  it("sums to 0n for an empty market list", () => {
    expect(sumPooled([])).toBe(0n);
  });

  it("formats base units (1e6 per display unit) with thousands separators", () => {
    expect(formatPooled(4_210_000_000n)).toBe("4,210");
    expect(formatPooled(0n)).toBe("0");
  });
});

describe("formatClock", () => {
  it("formats seconds as mm:ss, zero-padding seconds", () => {
    expect(formatClock(0)).toBe("0:00");
    expect(formatClock(125)).toBe("2:05");
    expect(formatClock(59)).toBe("0:59");
  });

  it("does not wrap minutes past 99 (extra time / long overtime)", () => {
    expect(formatClock(6001)).toBe("100:01");
  });
});

describe("formatKickoff", () => {
  it("formats a fixed epoch ms as a locale/timezone-independent UTC string", () => {
    // 1970-01-01T00:00:00Z was a Thursday.
    expect(formatKickoff(0)).toBe("Thu 00:00 UTC");
  });

  it("is stable regardless of the host runtime's default locale/timezone", () => {
    // Same instant, formatted twice — both calls must agree exactly, since
    // this same function runs once during SSR and once during hydration.
    const ms = 1784386800000;
    expect(formatKickoff(ms)).toBe(formatKickoff(ms));
    expect(formatKickoff(ms)).toBe("Sat 15:00 UTC");
  });
});
