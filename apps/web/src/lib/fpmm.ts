export function sharesOut(poolThis: bigint, poolOther: bigint, amountIn: bigint): bigint | null {
  if (poolThis === 0n || poolOther === 0n) return null;
  const k = poolThis * poolOther;
  const newOther = poolOther + amountIn;
  const newThisMin = (k + newOther - 1n) / newOther; // ceil-div, pool never loses
  const out = poolThis + amountIn - newThisMin;
  return out >= 0n && out <= 0xffffffffffffffffn ? out : null;
}
export function poolsAfterBuy(poolThis: bigint, poolOther: bigint, amountIn: bigint, shares: bigint): [bigint, bigint] {
  return [poolThis + amountIn - shares, poolOther + amountIn];
}
export function impliedProbPpm(poolThis: bigint, poolOther: bigint): number | null {
  const total = poolThis + poolOther;
  if (total === 0n) return null;
  return Number((poolOther * 1_000_000n) / total);
}
// ppm (0..1_000_000) -> integer cents (0..100), for MarketDTO.yesPpm price
// buttons (Task 11 brief: "yesPpm/10000 -> ¢").
export function ppmToCents(ppm: number): number {
  return Math.round(ppm / 10_000);
}
