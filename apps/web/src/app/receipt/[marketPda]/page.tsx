import { notFound } from "next/navigation";
import { ensureStarted } from "@/server/boot";
import { buildReceipt } from "@/server/receipt";
import { ReceiptChain } from "@/components/receipt-chain";

// Same reasoning as every other page in this app (see src/app/page.tsx):
// depends on live chain state read fresh per request, never statically
// rendered.
export const dynamic = "force-dynamic";

export default async function ReceiptPage({
  params,
}: {
  params: Promise<{ marketPda: string }>;
}) {
  ensureStarted();

  const { marketPda } = await params;

  // buildReceipt throws when the pda isn't a Market account (bad pda,
  // wrong program, typo) — same notFound() posture as /fixture/[fixtureId].
  const receipt = await buildReceipt(marketPda).catch(() => null);
  if (!receipt) notFound();

  return <ReceiptChain r={receipt} />;
}
