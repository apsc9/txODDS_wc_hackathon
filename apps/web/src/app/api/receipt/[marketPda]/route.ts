import "server-only";

import { ensureStarted, toErrorResponse } from "@/server/boot";
import { buildReceipt } from "@/server/receipt";

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ marketPda: string }> },
): Promise<Response> {
  try {
    ensureStarted();
  } catch (err) {
    return toErrorResponse(err);
  }

  const { marketPda } = await params;

  try {
    const receipt = await buildReceipt(marketPda);
    return Response.json(receipt);
  } catch (err) {
    // buildReceipt's `market.fetch` throws when the pda doesn't hold a
    // Market account (bad pda, wrong program, or the account simply doesn't
    // exist) — that's a client input error, not a server fault.
    return toErrorResponse(err, 404);
  }
}
