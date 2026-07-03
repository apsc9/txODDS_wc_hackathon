/**
 * Records TxLINE SSE streams (odds + scores) to JSONL files, one line per event:
 *   { recvTs, stream, event, id, data }
 * Raw packets are the source of truth for replay, backtesting, and the demo.
 * Reconnects with backoff; rotates files daily.
 *
 * Usage: npx tsx src/recorder.ts <network>   (default: mainnet)
 */
import fs from "node:fs";
import path from "node:path";
import { CONFIG, RECORDINGS_DIR, type Network } from "./config.js";
import { authenticate, apiClient } from "./auth.js";
import { readSseMessages } from "./sse.js";

const STREAMS = ["odds", "scores"] as const;
type StreamName = (typeof STREAMS)[number];

function outFile(network: Network, stream: StreamName): string {
  const day = new Date().toISOString().slice(0, 10);
  return path.join(RECORDINGS_DIR, `${network}-${stream}-${day}.jsonl`);
}

async function recordStream(network: Network, stream: StreamName): Promise<void> {
  const cfg = CONFIG[network];
  let backoffMs = 1000;
  for (;;) {
    try {
      const creds = await authenticate(network);
      const url = `${cfg.apiOrigin}/api/${stream}/stream`;
      const res = await fetch(url, {
        headers: {
          Authorization: `Bearer ${creds.jwt}`,
          "X-Api-Token": creds.apiToken,
          Accept: "text/event-stream",
          "Cache-Control": "no-cache",
        },
      });
      if (!res.ok) throw new Error(`${stream} stream HTTP ${res.status}`);
      console.log(`[recorder] ${network}/${stream} connected`);
      backoffMs = 1000;

      for await (const msg of readSseMessages(res)) {
        const line = JSON.stringify({
          recvTs: Date.now(),
          stream,
          event: msg.event ?? null,
          id: msg.id ?? null,
          data: msg.data,
        });
        fs.appendFileSync(outFile(network, stream), line + "\n");
      }
      console.warn(`[recorder] ${network}/${stream} stream ended, reconnecting`);
    } catch (err) {
      console.error(`[recorder] ${network}/${stream} error:`, (err as Error).message);
    }
    await new Promise((r) => setTimeout(r, backoffMs));
    backoffMs = Math.min(backoffMs * 2, 60_000);
  }
}

async function main() {
  const network = (process.argv[2] ?? "mainnet") as Network;
  fs.mkdirSync(RECORDINGS_DIR, { recursive: true });

  // snapshot fixtures once at startup for fixture-id -> teams mapping
  const creds = await authenticate(network);
  const { data: fixtures } = await apiClient(network, creds).get("/api/fixtures/snapshot");
  fs.writeFileSync(
    path.join(RECORDINGS_DIR, `${network}-fixtures-${new Date().toISOString().slice(0, 10)}.json`),
    JSON.stringify(fixtures, null, 2),
  );
  console.log(`[recorder] fixtures snapshot saved (${Array.isArray(fixtures) ? fixtures.length : "?"} entries)`);

  await Promise.all(STREAMS.map((s) => recordStream(network, s)));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
