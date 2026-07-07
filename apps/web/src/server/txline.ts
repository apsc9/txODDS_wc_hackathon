import "server-only";

import { readFileSync } from "node:fs";
import path from "node:path";
import { readSseMessages } from "./sse-parse";

const CREDS_REMEDY = "run: cd packages/ingest && npx tsx src/auth-cli.ts devnet";

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

export function loadTxlineCreds(): TxlineCreds {
  const credsPath = process.env.TXLINE_CREDS;
  if (!credsPath) {
    throw new Error(`TXLINE_CREDS is not set. ${CREDS_REMEDY}`);
  }

  const resolved = path.resolve(process.cwd(), credsPath);

  let raw: string;
  try {
    raw = readFileSync(resolved, "utf8");
  } catch (err) {
    throw new Error(
      `Failed to read TxLINE creds at ${resolved}: ${(err as Error).message}. ${CREDS_REMEDY}`
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error(
      `Failed to parse TxLINE creds at ${resolved}: ${(err as Error).message}. ${CREDS_REMEDY}`
    );
  }

  const creds = parsed as Partial<TxlineCreds>;
  if (!creds.jwt || !creds.apiToken) {
    throw new Error(`TxLINE creds at ${resolved} are missing jwt/apiToken. ${CREDS_REMEDY}`);
  }

  return { jwt: creds.jwt, apiToken: creds.apiToken };
}

function apiBase(): string {
  const base = process.env.TXLINE_API;
  if (!base) {
    throw new Error("TXLINE_API is not set.");
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

  async function connect(): Promise<void> {
    while (!stopped) {
      try {
        const url = `${apiBase()}/api/stream/${stream}`;
        const res = await fetch(url, { headers: authHeaders() });
        if (!res.ok || !res.body) {
          throw new Error(`TxLINE stream ${stream} failed: ${res.status} ${res.statusText}`);
        }
        for await (const message of readSseMessages(res)) {
          if (stopped) break;
          backoffMs = 1000;
          onMsg(message.data, message.event ?? null);
        }
      } catch {
        // fall through to reconnect below
      }

      if (stopped) break;
      onDown();
      await sleep(backoffMs);
      backoffMs = Math.min(backoffMs * 2, maxBackoffMs);
    }
  }

  void connect();

  return () => {
    stopped = true;
  };
}
