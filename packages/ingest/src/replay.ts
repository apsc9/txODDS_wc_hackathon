/**
 * Replay server: re-emits recorded JSONL packets as a local SSE endpoint so the
 * agent/UI can be developed and demoed without a live match.
 *
 *   GET /api/odds/stream        – replayed odds events
 *   GET /api/scores/stream      – replayed scores events
 *   GET /api/fixtures/snapshot  – recorded fixtures snapshot (needs --fixtures)
 *
 * Usage: npx tsx src/replay.ts <file.jsonl> [--speed 10] [--port 8787] [--fixtures <snapshot.json>] [--live-now]
 * Speed N compresses recorded inter-event gaps by N×; --speed 0 = flat 50ms.
 * --fixtures serves a recorder-saved `*-fixtures-*.json` so the web app's
 * fixtures load (and therefore its fixture pages) work in replay mode too.
 * --live-now rewrites StartTime to "just kicked off" in the served snapshot,
 * but only for fixtures that actually appear in the replayed packets — the
 * web app's classifyFixtureStatus otherwise sees a past kickoff and labels
 * the replayed match FT instead of LIVE.
 */
import fs from "node:fs";
import http from "node:http";

const args = process.argv.slice(2);
// Flags that consume the next arg as their value — their values must not be
// mistaken for the positional jsonl path (a bare `--fixtures foo.json` value
// doesn't start with `--`).
const VALUE_FLAGS = new Set(["--speed", "--port", "--fixtures"]);
const file = args.find((a, i) => !a.startsWith("--") && !VALUE_FLAGS.has(args[i - 1] ?? ""));
if (!file) {
  console.error(
    "usage: tsx src/replay.ts <file.jsonl> [--speed 10] [--port 8787] [--fixtures <snapshot.json>]",
  );
  process.exit(1);
}
const flag = (name: string, dflt: number) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? Number(args[i + 1]) : dflt;
};
const speed = flag("speed", 10);
const port = flag("port", 8787);
const fixturesIdx = args.indexOf("--fixtures");
const fixturesFile = fixturesIdx >= 0 ? args[fixturesIdx + 1] : undefined;
const liveNow = args.includes("--live-now");
// Read once at startup so a bad path fails loudly here, not per-request.
let fixturesJson = fixturesFile ? fs.readFileSync(fixturesFile, "utf8") : undefined;
if (fixturesFile) console.log(`[replay] serving fixtures snapshot from ${fixturesFile}`);

type Packet = { recvTs: number; stream: string; event: string | null; id: string | null; data: string };
const packets: Packet[] = fs
  .readFileSync(file, "utf8")
  .split("\n")
  .filter(Boolean)
  .map((l) => JSON.parse(l));
console.log(`[replay] loaded ${packets.length} packets from ${file}`);

if (liveNow && fixturesJson) {
  const fixtures = JSON.parse(fixturesJson) as Array<{ FixtureId: number; StartTime: number }>;
  const replayed = fixtures.filter((f) =>
    packets.some((p) => p.data.includes(`"FixtureId":${f.FixtureId}`)),
  );
  const kickoff = Date.now() - 60_000;
  for (const f of replayed) f.StartTime = kickoff;
  fixturesJson = JSON.stringify(fixtures);
  console.log(
    `[replay] --live-now: StartTime -> now-60s for ${replayed.map((f) => f.FixtureId).join(", ") || "(none matched)"}`,
  );
}

const server = http.createServer((req, res) => {
  if (req.url?.startsWith("/api/fixtures/snapshot")) {
    if (!fixturesJson) {
      res.writeHead(404).end("no fixtures snapshot; restart replay with --fixtures <snapshot.json>");
      return;
    }
    res.writeHead(200, {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
    });
    res.end(fixturesJson);
    return;
  }
  const m = req.url?.match(/^\/api\/(odds|scores)\/stream/);
  if (!m) {
    res.writeHead(404).end("not found; use /api/odds/stream, /api/scores/stream or /api/fixtures/snapshot");
    return;
  }
  const stream = m[1];
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
    "Access-Control-Allow-Origin": "*",
  });

  const mine = packets.filter((p) => p.stream === stream);
  console.log(`[replay] client connected to ${stream} (${mine.length} packets, speed ${speed}x)`);

  let i = 0;
  let closed = false;
  req.on("close", () => (closed = true));

  const emitNext = () => {
    if (closed || i >= mine.length) {
      if (!closed) res.end();
      return;
    }
    const p = mine[i];
    if (p.id) res.write(`id: ${p.id}\n`);
    if (p.event) res.write(`event: ${p.event}\n`);
    for (const line of p.data.split("\n")) res.write(`data: ${line}\n`);
    res.write("\n");
    i += 1;
    const gap =
      speed > 0 && i < mine.length
        ? Math.min(Math.max(mine[i].recvTs - p.recvTs, 0) / speed, 30_000)
        : 50;
    setTimeout(emitNext, gap);
  };
  emitNext();
});

server.listen(port, () => console.log(`[replay] SSE server on http://localhost:${port}`));
