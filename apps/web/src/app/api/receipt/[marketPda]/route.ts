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
    // Client-input errors — a malformed pda (`new PublicKey` throws
    // "Invalid public key input"), a pda that doesn't hold an account
    // (Anchor: "Account does not exist or has no data ..."), or one holding
    // some other program's account ("Invalid account discriminator") — are
    // 404s. Anything else (RPC connection refused, timeout, 429, ...) is an
    // upstream fault: a devnet RPC blip must not render a perfectly valid
    // receipt as nonexistent, so those map to 503 instead.
    const message = err instanceof Error ? err.message : "";
    const isMissingAccount =
      /account does not exist|invalid account discriminator|invalid public key/i.test(message);
    return toErrorResponse(err, isMissingAccount ? 404 : 503);
  }
}
