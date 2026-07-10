import "server-only";

import { PublicKey } from "@solana/web3.js";

import { ensureStarted, toErrorResponse } from "@/server/boot";
import { fetchPositions } from "@/server/chain";

export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  try {
    ensureStarted();
  } catch (err) {
    return toErrorResponse(err);
  }

  const owner = new URL(request.url).searchParams.get("owner");
  if (!owner) {
    return Response.json({ error: "owner is required" }, { status: 400 });
  }
  try {
    new PublicKey(owner);
  } catch {
    return Response.json({ error: "owner must be a valid base58 public key" }, { status: 400 });
  }

  try {
    const positions = await fetchPositions(owner);
    return Response.json({ positions });
  } catch (err) {
    return toErrorResponse(err);
  }
}
