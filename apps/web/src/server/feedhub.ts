import "server-only";

import { fetchFixturesSnapshot, openStream, type Fixture } from "./txline";
import { decodeStatKey, BASE, type PredicateFields } from "../lib/statkeys";

const HISTORY_CAP = 2000;

export type LiveScore = {
  fixtureId: number;
  gameState: string | null;
  clockSeconds: number | null;
  stats: Record<string, number>;
  seq: number;
  ts: number;
  recvTs: number;
};

export type Consensus = {
  pctByName: Record<string, number>;
  ts: number;
};

export type PricePoint = {
  ts: number;
  poolPpm: number;
  fairPpm: number | null;
};

export type GoalEvent = {
  ts: number;
  clockSeconds: number | null;
  team: 1 | 2;
};

export type HubEvent =
  | { type: "score"; fixtureId: number }
  | { type: "price"; marketPda: string }
  | { type: "markets" }
  | { type: "feed"; up: boolean };

// The full DTO (pda, mint, pools, status, ...) is defined in Task 6's
// server/chain.ts, which reads/writes hub.marketCache. `fairPpmFor` only
// needs the predicate shape it already knows from Task 3 plus the fixture it
// belongs to, so we key off that minimal, forward-compatible slice here.
export type MarketDTO = PredicateFields & { fixtureId: number };

export type Hub = {
  fixtures: Map<number, Fixture>;
  scores: Map<number, LiveScore>;
  consensus: Map<string, Consensus>;
  history: Map<string, PricePoint[]>;
  goalEvents: Map<number, GoalEvent[]>;
  marketCache: Map<string, MarketDTO>;
  feedUp: boolean;
  lastPacketTs: number;
  start(): void;
  fairPpmFor(m: MarketDTO): number | null;
  pushPrice(marketPda: string, point: PricePoint): void;
  subscribe(fn: (evt: HubEvent) => void): () => void;
};

type OddsPacket = {
  FixtureId: number;
  SuperOddsType: string;
  MarketParameters: string | null;
  Bookmaker: string;
  PriceNames: string[];
  Pct: string[];
  Ts?: number;
};

type ScoresPacket = {
  FixtureId: number;
  GameState: string | null;
  Ts: number;
  Seq: number;
  Clock?: { Running: boolean; Seconds: number };
  Stats: Record<string, unknown>;
};

type HubBuild = {
  hub: Hub;
  ingestOdds: (dataStr: string, event?: string | null) => void;
  ingestScores: (dataStr: string, event?: string | null) => void;
};

function buildHub(): HubBuild {
  const fixtures = new Map<number, Fixture>();
  const scores = new Map<number, LiveScore>();
  const consensus = new Map<string, Consensus>();
  const history = new Map<string, PricePoint[]>();
  const goalEvents = new Map<number, GoalEvent[]>();
  const marketCache = new Map<string, MarketDTO>();
  const listeners = new Set<(evt: HubEvent) => void>();

  let started = false;
  let stopOdds: (() => void) | null = null;
  let stopScores: (() => void) | null = null;

  function emit(evt: HubEvent): void {
    for (const fn of listeners) {
      try {
        fn(evt);
      } catch (err) {
        // A subscriber's own bug must not look like a stream failure to the
        // caller (ingestScores/ingestOdds run inside openStream's message
        // loop) — one bad listener would otherwise take the whole feed down.
        console.error("feedhub: listener threw", err);
      }
    }
  }

  function setFeedUp(up: boolean): void {
    if (self.feedUp !== up) {
      self.feedUp = up;
      emit({ type: "feed", up });
    }
  }

  function subscribe(fn: (evt: HubEvent) => void): () => void {
    listeners.add(fn);
    return () => {
      listeners.delete(fn);
    };
  }

  function pushPrice(marketPda: string, point: PricePoint): void {
    let arr = history.get(marketPda);
    if (!arr) {
      arr = [];
      history.set(marketPda, arr);
    }
    arr.push(point);
    if (arr.length > HISTORY_CAP) {
      arr.splice(0, arr.length - HISTORY_CAP);
    }
    emit({ type: "price", marketPda });
  }

  function fairPpmFor(m: MarketDTO): number | null {
    if (m.op === "Add" && m.comparison === "GreaterThan" && m.statKeyB !== null) {
      const a = decodeStatKey(m.statKeyA);
      const b = decodeStatKey(m.statKeyB);
      const isGoalsPair =
        a.period === b.period &&
        ((a.base === BASE.GOALS_T1 && b.base === BASE.GOALS_T2) ||
          (a.base === BASE.GOALS_T2 && b.base === BASE.GOALS_T1));
      if (isGoalsPair) {
        const key = `${m.fixtureId}:OVERUNDER_PARTICIPANT_GOALS:line=${m.threshold}.5`;
        const c = consensus.get(key);
        const pct = c?.pctByName["over"];
        return Number.isFinite(pct) ? Math.round((pct as number) * 10000) : null;
      }
      return null;
    }

    if (m.op === "Subtract" && m.comparison === "GreaterThan" && m.threshold === 0) {
      const key = `${m.fixtureId}:1X2_PARTICIPANT_RESULT:`;
      const c = consensus.get(key);
      const pct = c?.pctByName["part1"];
      return Number.isFinite(pct) ? Math.round((pct as number) * 10000) : null;
    }

    return null;
  }

  function ingestOdds(dataStr: string, event: string | null = null): void {
    self.lastPacketTs = Date.now();
    setFeedUp(true);
    if (event === "heartbeat") return;

    let pkt: Partial<OddsPacket>;
    try {
      pkt = JSON.parse(dataStr);
    } catch {
      return;
    }

    if (
      pkt.Bookmaker !== "TXLineStablePriceDemargined" ||
      typeof pkt.FixtureId !== "number" ||
      typeof pkt.SuperOddsType !== "string" ||
      !Array.isArray(pkt.PriceNames) ||
      !Array.isArray(pkt.Pct)
    ) {
      return;
    }

    const pctByName: Record<string, number> = {};
    pkt.PriceNames.forEach((name, i) => {
      pctByName[name] = parseFloat(pkt.Pct![i]);
    });

    const key = `${pkt.FixtureId}:${pkt.SuperOddsType}:${pkt.MarketParameters ?? ""}`;
    const ts = typeof pkt.Ts === "number" ? pkt.Ts : Date.now();
    consensus.set(key, { pctByName, ts });
  }

  function ingestScores(dataStr: string, event: string | null = null): void {
    self.lastPacketTs = Date.now();
    setFeedUp(true);
    if (event === "heartbeat") return;

    let pkt: Partial<ScoresPacket>;
    try {
      pkt = JSON.parse(dataStr);
    } catch {
      return;
    }

    if (typeof pkt.FixtureId !== "number") return;
    const fixtureId = pkt.FixtureId;
    const prev = scores.get(fixtureId);

    const rawStats = pkt.Stats ?? {};
    const stats: Record<string, number> = {};
    for (const [k, v] of Object.entries(rawStats)) {
      stats[k] = Number(v);
    }

    const clockSeconds =
      pkt.Clock && typeof pkt.Clock.Seconds === "number" ? pkt.Clock.Seconds : null;
    const ts = typeof pkt.Ts === "number" ? pkt.Ts : Date.now();

    const next: LiveScore = {
      fixtureId,
      gameState: pkt.GameState ?? null,
      clockSeconds,
      stats,
      seq: typeof pkt.Seq === "number" ? pkt.Seq : 0,
      ts,
      recvTs: Date.now(),
    };
    scores.set(fixtureId, next);

    let events = goalEvents.get(fixtureId);
    if (!events) {
      events = [];
      goalEvents.set(fixtureId, events);
    }

    // If we've never seen this fixture before, this packet is our baseline,
    // not a delta — a mid-match connect (e.g. score already 2-1) must not
    // be read as 3 goals just scored. Only diff once we have a real `prev`.
    if (prev !== undefined) {
      const prevG1 = prev.stats["1"] ?? 0;
      const prevG2 = prev.stats["2"] ?? 0;
      const nextG1 = stats["1"] ?? 0;
      const nextG2 = stats["2"] ?? 0;
      if (nextG1 > prevG1) events.push({ ts, clockSeconds, team: 1 });
      if (nextG2 > prevG2) events.push({ ts, clockSeconds, team: 2 });
    }

    emit({ type: "score", fixtureId });
  }

  function start(): void {
    if (started) return;
    started = true;

    fetchFixturesSnapshot()
      .then((list) => {
        for (const f of list) fixtures.set(f.FixtureId, f);
      })
      .catch(() => {
        // a failed snapshot fetch shouldn't prevent the live streams from
        // starting; fixtures will stay empty until the next successful call.
      });

    stopOdds = openStream("odds", ingestOdds, () => setFeedUp(false));
    stopScores = openStream("scores", ingestScores, () => setFeedUp(false));
  }

  const self: Hub = {
    fixtures,
    scores,
    consensus,
    history,
    goalEvents,
    marketCache,
    feedUp: false,
    lastPacketTs: 0,
    start,
    fairPpmFor,
    pushPrice,
    subscribe,
  };

  return { hub: self, ingestOdds, ingestScores };
}

declare global {
  // eslint-disable-next-line no-var
  var __fulltimeHub: HubBuild | undefined;
}

const instance = globalThis.__fulltimeHub ?? (globalThis.__fulltimeHub = buildHub());

export const hub = instance.hub;
export const ingestOdds = instance.ingestOdds;
export const ingestScores = instance.ingestScores;
