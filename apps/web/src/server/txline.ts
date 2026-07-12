import "server-only";

import { readFileSync } from "node:fs";
import path from "node:path";
import { readSseMessages } from "./sse-parse";

const CREDS_REMEDY = "run: cd packages/ingest && npx tsx src/auth-cli.ts devnet";

// Thrown by loadTxlineCreds for a missing/malformed local creds file — a
// setup problem the *developer running this locally* needs to see and act
// on (hence the actionable CREDS_REMEDY copy), as opposed to an unexpected
// runtime fault. `toErrorResponse` (./boot.ts) checks for this type to
// decide whether a route's error response may surface its message verbatim
// or must fall back to generic copy — see that function's doc comment.
export class SetupError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SetupError";
  }
}

export type TxlineCreds = {
  jwt: string;
  apiToken: string;
};

export type Fixture = {
  FixtureId: number;
  StartTime: number;
  Participant1: string;
  Participant2: string;
  Participant1IsHome: boolean;
  Competition: string;
};

// Thrown messages here intentionally name `TXLINE_CREDS` (the env var the
// developer set) rather than its resolved absolute filesystem path — the
// resolved path was previously interpolated into these messages, which
// `toErrorResponse` (./boot.ts) forwards verbatim to the HTTP client, i.e.
// leaking this machine's local directory layout (username, repo location)
// into a browser response. The resolved path is still logged to the server
// console below for local debugging; it just never leaves the process.
export function loadTxlineCreds(): TxlineCreds {
  const credsPath = process.env.TXLINE_CREDS;
  if (!credsPath) {
    throw new SetupError(`TXLINE_CREDS is not set. ${CREDS_REMEDY}`);
  }

  const resolved = path.resolve(process.cwd(), credsPath);

  let raw: string;
  try {
    raw = readFileSync(resolved, "utf8");
  } catch (err) {
    console.error(`[txline] failed to read creds file at ${resolved}:`, err);
    throw new SetupError(`Failed to read TxLINE creds at "${credsPath}". ${CREDS_REMEDY}`);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    console.error(`[txline] failed to parse creds file at ${resolved}:`, err);
    throw new SetupError(`Failed to parse TxLINE creds at "${credsPath}". ${CREDS_REMEDY}`);
  }

  const creds = parsed as Partial<TxlineCreds>;
  if (!creds.jwt || !creds.apiToken) {
    console.error(`[txline] TxLINE creds at ${resolved} are missing jwt/apiToken`);
    throw new SetupError(`TxLINE creds at "${credsPath}" are missing jwt/apiToken. ${CREDS_REMEDY}`);
  }

  return { jwt: creds.jwt, apiToken: creds.apiToken };
}

function apiBase(): string {
  const base = process.env.TXLINE_API;
  if (!base) {
    throw new SetupError("TXLINE_API is not set. Copy .env.local.example to .env.local and fill it in.");
  }
  return base;
}

function authHeaders(): Record<string, string> {
  const { jwt, apiToken } = loadTxlineCreds();
  return {
    Authorization: `Bearer ${jwt}`,
    "X-Api-Token": apiToken,
  };
}

export async function txlineGet<T>(path: string, params?: Record<string, string>): Promise<T> {
  const url = new URL(path, apiBase());
  if (params) {
    for (const [key, value] of Object.entries(params)) {
      url.searchParams.set(key, value);
    }
  }

  const res = await fetch(url.toString(), { headers: authHeaders() });
  if (!res.ok) {
    throw new Error(`TxLINE GET ${path} failed: ${res.status} ${res.statusText}`);
  }
  return (await res.json()) as T;
}

export async function fetchFixturesSnapshot(): Promise<Fixture[]> {
  return txlineGet<Fixture[]>("/api/fixtures/snapshot");
}

export async function fetchProof(
  fixtureId: number,
  seq: number,
  statKeys: number[]
): Promise<unknown> {
  const params: Record<string, string> = {
    fixtureId: String(fixtureId),
    seq: String(seq),
    statKey: String(statKeys[0]),
  };
  if (statKeys.length > 1) {
    params.statKey2 = String(statKeys[1]);
  }
  return txlineGet<unknown>("/api/scores/stat-validation", params);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function openStream(
  stream: "odds" | "scores",
  onMsg: (data: string, event: string | null) => void,
  onDown: () => void
): () => void {
  let stopped = false;
  let backoffMs = 1000;
  const maxBackoffMs = 30000;
  let controller: AbortController | null = null;

  async function connect(): Promise<void> {
    while (!stopped) {
      controller = new AbortController();
      try {
        const url = `${apiBase()}/api/${stream}/stream`;
        const res = await fetch(url, {
          headers: {
            ...authHeaders(),
            Accept: "text/event-stream",
            "Cache-Control": "no-cache",
          },
          signal: controller.signal,
        });
        if (!res.ok || !res.body) {
          throw new Error(`TxLINE stream ${stream} failed: ${res.status} ${res.statusText}`);
        }
        for await (const message of readSseMessages(res)) {
          if (stopped) break;
          backoffMs = 1000;
          onMsg(message.data, message.event ?? null);
        }
      } catch (err) {
        if (stopped && err instanceof Error && err.name === "AbortError") {
          // stop() aborted the in-flight connection — clean shutdown, not a failure.
          break;
        }
        // any other error (network, non-ok status, mid-stream drop): fall
        // through to reconnect below
      }

      if (stopped) break;
      try {
        onDown();
      } catch {
        // a throwing onDown must not break the reconnect loop or produce an
        // unhandled rejection
      }
      await sleep(backoffMs);
      backoffMs = Math.min(backoffMs * 2, maxBackoffMs);
    }
  }

  void connect().catch(() => {
    // defense-in-depth: connect()'s internal loop already catches everything,
    // but guard against an unhandled rejection if that ever changes.
  });

  return () => {
    stopped = true;
    controller?.abort();
  };
}
