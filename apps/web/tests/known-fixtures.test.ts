import { describe, expect, it } from "vitest";
import { fixtureTeams, KNOWN_FIXTURES } from "@/lib/known-fixtures";

describe("fixtureTeams", () => {
  it("prefers the live hub entry over the static fallback", () => {
    const hub = new Map([[18237038, { Participant1: "Live1", Participant2: "Live2" }]]);
    expect(fixtureTeams(hub, 18237038)).toEqual({ t1: "Live1", t2: "Live2" });
  });

  it("falls back to KNOWN_FIXTURES when the hub misses", () => {
    expect(fixtureTeams(new Map(), 18237038)).toEqual({ t1: "France", t2: "Spain" });
  });

  it("returns undefined names for a fixture known nowhere", () => {
    expect(fixtureTeams(new Map(), 99999999)).toEqual({ t1: undefined, t2: undefined });
  });

  it("covers every historically seeded fixture", () => {
    // The sample agent log (data/agent-sample/decisions.jsonl) references
    // 18241006; a regression here would put "Home to win" back on /agent.
    expect(KNOWN_FIXTURES[18241006]).toEqual({
      Participant1: "England",
      Participant2: "Argentina",
    });
  });
});
