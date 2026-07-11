import { describe, it, expect } from "vitest";
import { sharesOut, poolsAfterBuy, impliedProbPpm, ppmToCents } from "../src/lib/fpmm";
describe("fpmm mirrors amm.rs", () => {
  it("balanced pool: out in (stake, 2*stake)", () => {
    const out = sharesOut(1_000_000n, 1_000_000n, 100_000n)!;
    expect(out > 100_000n && out < 200_000n).toBe(true);
  });
  it("product invariant never decreases", () => {
    const out = sharesOut(1_000_000n, 500_000n, 123_457n)!;
    const [ny, nn] = poolsAfterBuy(1_000_000n, 500_000n, 123_457n, out);
    expect(ny * nn >= 1_000_000n * 500_000n).toBe(true);
  });
  it("payout never exceeds collateral (50 buys)", () => {
    let py = 1_000_000n, pn = 1_000_000n, collateral = 1_000_000n, userYes = 0n;
    for (let i = 0; i < 50; i++) {
      const out = sharesOut(py, pn, 250_000n)!;
      [py, pn] = poolsAfterBuy(py, pn, 250_000n, out);
      collateral += 250_000n; userYes += out;
    }
    expect(userYes + py).toBe(collateral);
  });
  it("price moves toward bought side; empty pool null", () => {
    expect(impliedProbPpm(1_000_000n, 1_000_000n)).toBe(500_000);
    const out = sharesOut(1_000_000n, 1_000_000n, 500_000n)!;
    const [py, pn] = poolsAfterBuy(1_000_000n, 1_000_000n, 500_000n, out);
    expect(impliedProbPpm(py, pn)! > 500_000).toBe(true);
    expect(sharesOut(0n, 1n, 1n)).toBeNull();
  });
});

describe("ppmToCents", () => {
  it("converts a fresh 50/50 seed (500000 ppm) to 50 cents", () => {
    expect(ppmToCents(500_000)).toBe(50);
  });
  it("converts 720000 ppm to 72 cents", () => {
    expect(ppmToCents(720_000)).toBe(72);
  });
  it("rounds rather than truncates", () => {
    expect(ppmToCents(345_678)).toBe(35); // 34.5678 -> rounds to 35
  });
});
