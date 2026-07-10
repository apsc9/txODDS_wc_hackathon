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

  const fixtureIdParam = new URL(request.url).searchParams.get("fixtureId");
  if (fixtureIdParam === null) {
    return Response.json({ error: "fixtureId is required" }, { status: 400 });
  }

  const fixtureId = Number(fixtureIdParam);
  if (!Number.isInteger(fixtureId)) {
    return Response.json({ error: "fixtureId must be an integer" }, { status: 400 });
  }

  const markets = Array.from(hub.marketCache.values()).filter(
    (m) => m.fixtureId === fixtureId
  );

  return Response.json({ markets });
}
