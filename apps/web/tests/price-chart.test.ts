import { describe, it, expect } from "vitest";
import { toPath, windowStart, CHART_H, CHART_W } from "../src/lib/price-chart";

describe("toPath", () => {
  it("two points map to a single M...L... path across the full x/y range", () => {
    // t=0 -> x=0; t=100 -> x=CHART_W (full width)
    // v=50 -> y=CHART_H/2 (mid); v=100 -> y=0 (top)
    const points = [
      { t: 0, v: 50 },
      { t: 100, v: 100 },
    ];
    const d = toPath(points, 0, 100);
    expect(d).toBe(`M0,${CHART_H / 2} L${CHART_W},0`);
  });

  it("splits into two subpaths around a null fair-value gap", () => {
    const points = [
      { t: 0, v: 50 },
      { t: 10, v: 60 },
      { t: 20, v: null },
      { t: 30, v: 70 },
      { t: 40, v: 80 },
    ];
    const d = toPath(points, 0, 40);
    // x = (t/40)*640 -> 0, 160, (skip), 480, 640
    // y = 160 - (v/100)*160 -> 80, 64, (skip), 48, 32
    expect(d).toBe("M0,80 L160,64 M480,48 L640,32");
    // Two independent subpaths (two "M" commands), proving the null gap
    // wasn't bridged by a line.
    expect(d.match(/M/g)?.length).toBe(2);
  });

  it("a single point (no line to draw) still emits a bare M so a dot can anchor to it", () => {
    const d = toPath([{ t: 5, v: 25 }], 0, 10);
    expect(d).toBe(`M${CHART_W / 2},${CHART_H - 40}`);
  });

  it("empty points yields an empty path", () => {
    expect(toPath([], 0, 100)).toBe("");
  });
});

describe("windowStart", () => {
  const HOUR = 60 * 60 * 1000;

  it("1H is always now-minus-an-hour, regardless of kickoff", () => {
    expect(windowStart("1H", 5_000_000, 10_000_000)).toBe(10_000_000 - HOUR);
  });

  it("ALL has no lower bound", () => {
    expect(windowStart("ALL", 5_000_000, 10_000_000)).toBe(-Infinity);
  });

  it("MATCH bounds to kickoff once the match has started", () => {
    const kickoff = 5_000_000;
    const now = kickoff + HOUR; // well past kickoff
    expect(windowStart("MATCH", kickoff, now)).toBe(kickoff);
  });

  it("MATCH falls back to unbounded (like ALL) while still pre-kickoff", () => {
    const kickoff = 10_000_000;
    const now = 5_000_000; // before kickoff — a "since kickoff" bound would hide all pre-match history
    expect(windowStart("MATCH", kickoff, now)).toBe(-Infinity);
  });
});
