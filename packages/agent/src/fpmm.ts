// Copied verbatim from apps/web/src/lib/fpmm.ts (sharesOut, impliedProbPpm).
// The web app is frozen for Track 1 review, so the agent carries its own
// copy rather than importing across packages. If pool math ever changes
// on-chain, BOTH copies must change.
export function sharesOut(poolThis: bigint, poolOther: bigint, amountIn: bigint): bigint | null {
  if (poolThis === 0n || poolOther === 0n) return null;
  const k = poolThis * poolOther;
  const newOther = poolOther + amountIn;
  const newThisMin = (k + newOther - 1n) / newOther; // ceil-div, pool never loses
  const out = poolThis + amountIn - newThisMin;
  return out >= 0n && out <= 0xffffffffffffffffn ? out : null;
}
export function impliedProbPpm(poolThis: bigint, poolOther: bigint): number | null {
  const total = poolThis + poolOther;
  if (total === 0n) return null;
  return Number((poolOther * 1_000_000n) / total);
}
