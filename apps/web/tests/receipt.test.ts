import { describe, it, expect } from "vitest";
import { decodeResolveIx } from "../src/server/receipt";
import resolveTxFixture from "./fixtures/resolve-tx.json";

// Real devnet resolve() instruction data (see fixtures/resolve-tx.json's
// _comment for provenance) — proves decodeResolveIx against an actual
// on-chain Borsh-encoded ValidationBundle, not a hand-built one.
describe("decodeResolveIx", () => {
  it("decodes a real captured resolve instruction", () => {
    const decoded = decodeResolveIx(resolveTxFixture.dataBase58);

    expect(decoded).not.toBeNull();
    expect(decoded!.name).toBe("resolve");
    expect(decoded!.bundle.stat_a.stat_to_prove.value).toBeGreaterThan(0);
  });

  it("carries the fixture id and packet ts through from the raw bundle", () => {
    const decoded = decodeResolveIx(resolveTxFixture.dataBase58);

    expect(Number(decoded!.bundle.fixture_summary.fixture_id.toString())).toBe(
      resolveTxFixture.fixtureId,
    );
    // Bundle ts is epoch milliseconds (Global Constraints: feed timestamps
    // are always 13-digit ms), matching the "packet ts" logged by
    // smoke-devnet.ts when this fixture was captured.
    expect(Number(decoded!.bundle.ts.toString())).toBeGreaterThan(1_700_000_000_000);
  });

  it("returns null for data that doesn't match the resolve discriminator", () => {
    // 32 zero bytes, base58-encoded — a validly-decodable but non-matching
    // instruction payload (no real discriminator is all zero bytes).
    const zeroDataBase58 = "11111111111111111111111111111111111111111";
    expect(decodeResolveIx(zeroDataBase58)).toBeNull();
  });
});
