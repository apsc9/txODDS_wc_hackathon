import { describe, it, expect } from "vitest";
import { parseArgs } from "../src/config.js";
import { DEFAULT_CONFIG } from "../src/engine.js";

describe("parseArgs", () => {
  it("defaults: dry-run, localhost API, auto-discover fixtures", () => {
    const c = parseArgs([]);
    expect(c.live).toBe(false);
    expect(c.apiBase).toBe("http://localhost:3000");
    expect(c.fixtureIds).toBeNull();
    expect(c.engine).toEqual(DEFAULT_CONFIG);
    expect(c.logPath.endsWith("decisions.jsonl")).toBe(true);
  });

  it("parses --live, --api, --fixtures", () => {
    const c = parseArgs(["--live", "--api", "http://x:4000", "--fixtures", "18241006,18237038"]);
    expect(c.live).toBe(true);
    expect(c.apiBase).toBe("http://x:4000");
    expect(c.fixtureIds).toEqual([18241006, 18237038]);
  });

  it("rejects malformed --fixtures", () => {
    expect(() => parseArgs(["--fixtures", "abc"])).toThrow(/fixtures/i);
  });
});
