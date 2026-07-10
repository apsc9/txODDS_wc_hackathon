import "server-only";

import { ensureStarted, toErrorResponse } from "@/server/boot";
import { hub } from "@/server/feedhub";

export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  try {
    ensureStarted();
  } catch (err) {
    return toErrorResponse(err);
  }

  const marketPda = new URL(request.url).searchParams.get("market");
  if (!marketPda) {
    return Response.json({ error: "market is required" }, { status: 400 });
  }

  const points = hub.history.get(marketPda) ?? [];

  // Goals belong to the market's fixture, not the market itself — look up
  // the cached on-chain DTO for its fixtureId. An unknown/not-yet-cached pda
  // just yields no goals rather than a 404: same "may be empty pre-seeder"
  // posture as /api/markets.
  const dto = hub.marketCache.get(marketPda);
  const goals = dto ? hub.goalEvents.get(dto.fixtureId) ?? [] : [];

  return Response.json({ points, goals });
}
