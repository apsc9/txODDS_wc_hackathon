import { ensureStarted } from "@/server/boot";
import { hub } from "@/server/feedhub";
import { PortfolioView } from "@/components/portfolio-view";

// Same reasoning as every /api/* route and the home page: this page's output
// depends on live, in-memory hub state that changes between requests, so it
// must never be statically rendered/cached by Next — a stale build-time
// snapshot would defeat the entire point of the live markets cache.
export const dynamic = "force-dynamic";

export default async function PortfolioPage() {
  ensureStarted();

  const markets = Array.from(hub.marketCache.values());

  return (
    <div>
      <PortfolioView initial={markets} />
    </div>
  );
}
