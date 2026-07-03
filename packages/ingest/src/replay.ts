/**
 * Replay server: re-emits recorded JSONL packets as a local SSE endpoint so the
 * agent/UI can be developed and demoed without a live match.
 *
 *   GET /api/odds/stream    – replayed odds events
 *   GET /api/scores/stream  – replayed scores events
 *
 * Usage: npx tsx src/replay.ts <file.jsonl> [--speed 10] [--port 8787]
 * Speed N compresses recorded inter-event gaps by N×; --speed 0 = flat 50ms.
 */
import fs from "node:fs";
import http from "node:http";

const args = process.argv.slice(2);
const file = args.find((a) => !a.startsWith("--"));
if (!file) {
  console.error("usage: tsx src/replay.ts <file.jsonl> [--speed 10] [--port 8787]");
  process.exit(1);
}
const flag = (name: string, dflt: number) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? Number(args[i + 1]) : dflt;
};
const speed = flag("speed", 10);
const port = flag("port", 8787);

type Packet = { recvTs: number; stream: string; event: string | null; id: string | null; data: string };
const packets: Packet[] = fs
  .readFileSync(file, "utf8")
  .split("\n")
  .filter(Boolean)
  .map((l) => JSON.parse(l));
console.log(`[replay] loaded ${packets.length} packets from ${file}`);

const server = http.createServer((req, res) => {
  const m = req.url?.match(/^\/api\/(odds|scores)\/stream/);
  if (!m) {
    res.writeHead(404).end("not found; use /api/odds/stream or /api/scores/stream");
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
