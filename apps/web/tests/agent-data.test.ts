import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { readAgentLog } from "@/server/agent-data";

const LINE =
  '{"ts":1,"fixtureId":18241006,"marketPda":"A","kind":"trade","tx":"T1","amountInUnits":"5000000"}\n';

let tmp: string;
afterEach(() => {
  if (tmp) fs.rmSync(tmp, { recursive: true, force: true });
});

function makeBase(dirs: { live?: boolean; sample?: boolean }): string {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "agent-data-"));
  if (dirs.live) {
    fs.mkdirSync(path.join(tmp, "data/agent"), { recursive: true });
    fs.writeFileSync(path.join(tmp, "data/agent/decisions.jsonl"), LINE + LINE);
  }
  if (dirs.sample) {
    fs.mkdirSync(path.join(tmp, "data/agent-sample"), { recursive: true });
    fs.writeFileSync(path.join(tmp, "data/agent-sample/decisions.jsonl"), LINE);
  }
  return tmp;
}

describe("readAgentLog", () => {
  it("prefers the live log when both exist", () => {
    const log = readAgentLog(makeBase({ live: true, sample: true }));
    expect(log.source).toBe("live");
    expect(log.records).toHaveLength(2);
  });

  it("falls back to the committed sample when live log is absent", () => {
    const log = readAgentLog(makeBase({ sample: true }));
    expect(log.source).toBe("sample");
    expect(log.records).toHaveLength(1);
  });

  it("returns empty/none when neither exists", () => {
    const log = readAgentLog(makeBase({}));
    expect(log.source).toBe("none");
    expect(log.records).toEqual([]);
  });
});
