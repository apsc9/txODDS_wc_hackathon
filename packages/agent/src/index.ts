/**
 * Touchline agent entry. DRY-RUN by default; pass --live to trade/resolve.
 * Usage: npm run agent [-- --live --fixtures 18241006 --api http://localhost:3000]
 */
import { parseArgs } from "./config.js";
import { makeTrader, fetchOpenMarkets } from "./trader.js";
import { runKeeperPass } from "./keeper.js";

const TRADE_TICK_MS = 5_000;
const KEEPER_TICK_MS = 120_000;

async function main() {
  const cfg = parseArgs(process.argv.slice(2));
  console.log(
    `[agent] Touchline starting — mode: ${cfg.live ? "LIVE" : "DRY-RUN"}, api: ${cfg.apiBase}, fixtures: ${cfg.fixtureIds?.join(",") ?? "auto"}`
  );
  const trader = makeTrader(cfg);
  const lastKeeperPass = new Map<number, number>();

  // Recursive setTimeout (not setInterval) so a slow tick never overlaps the
  // next one — same pattern as apps/web/src/server/chain.ts's poller.
  const traderLoop = () => {
    trader
      .tick()
      .catch((e) => console.error("[trader] tick failed:", e?.message ?? e))
      .finally(() => setTimeout(traderLoop, TRADE_TICK_MS));
  };
  const keeperLoop = () => {
    fetchOpenMarkets(cfg.apiBase, cfg.fixtureIds)
      .then((markets) => runKeeperPass(cfg, markets, lastKeeperPass))
      .catch((e) => console.error("[keeper] pass failed:", e?.message ?? e))
      .finally(() => setTimeout(keeperLoop, KEEPER_TICK_MS));
  };
  traderLoop();
  keeperLoop();
}

main().catch((e) => {
  console.error("[agent] FAILED:", e.message ?? e);
  process.exit(1);
});
