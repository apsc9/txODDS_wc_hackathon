// Static team-name fallback for fixtures whose markets live on-chain but
// which have rolled off the live TxLINE fixtures snapshot (the feed only
// lists a ~few-day window around now). Without this, any label rendered
// from hub.fixtures alone degrades to "Home to win" / no team names once a
// match ages out — which is exactly when receipts and the agent's historic
// trades are being shown. Names are fixed historical facts recorded from
// the feed's own snapshots (data/recordings/devnet-fixtures-*.json), so a
// hard-coded map is safe; the live hub entry still wins when present.
export type KnownFixture = { Participant1: string; Participant2: string };

export const KNOWN_FIXTURES: Record<number, KnownFixture> = {
  18213979: { Participant1: "Norway", Participant2: "England" },
  18218149: { Participant1: "Spain", Participant2: "Belgium" },
  18222446: { Participant1: "Argentina", Participant2: "Switzerland" },
  18237038: { Participant1: "France", Participant2: "Spain" },
  18241006: { Participant1: "England", Participant2: "Argentina" },
  18257739: { Participant1: "Spain", Participant2: "Argentina" },
  18257865: { Participant1: "France", Participant2: "England" },
};

// Live feed entry first, static fallback second. `fixtures` accepts any
// Map whose values carry Participant1/Participant2 so both the hub's full
// Fixture objects and test doubles satisfy it.
export function fixtureTeams(
  fixtures: ReadonlyMap<number, KnownFixture> | Map<number, { Participant1: string; Participant2: string }>,
  fixtureId: number
): { t1?: string; t2?: string } {
  const fx = fixtures.get(fixtureId) ?? KNOWN_FIXTURES[fixtureId];
  return { t1: fx?.Participant1, t2: fx?.Participant2 };
}
