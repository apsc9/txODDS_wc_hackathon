"use client";

import { useWallet } from "@solana/wallet-adapter-react";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";
import { usePositions } from "@/hooks/use-positions";
import { TicketStub } from "@/components/ticket-stub";
import type { MarketDTO } from "@/lib/types";

export function PortfolioView({ initial }: { initial: MarketDTO[] }) {
  const { connected, publicKey } = useWallet();
  const { setVisible } = useWalletModal();
  const { tickets, isLoading } = usePositions(publicKey?.toBase58(), initial);

  return (
    <div>
      <h1 className="label mb-6">PORTFOLIO</h1>

      {!connected ? (
        <div className="flex flex-col items-start gap-3">
          <p className="text-sm text-[var(--t3)]">Connect a wallet to see your positions.</p>
          <button
            type="button"
            onClick={() => setVisible(true)}
            className="font-display border border-[var(--gold)] px-4 py-2 text-xs font-semibold tracking-[0.12em] text-[var(--gold)] transition-colors hover:bg-[var(--surface-hi)]"
          >
            CONNECT WALLET
          </button>
        </div>
      ) : isLoading ? (
        <p className="text-sm text-[var(--t3)]">Loading positions…</p>
      ) : tickets.length === 0 ? (
        <p className="text-sm text-[var(--t3)]">No positions yet — place a trade from a match page.</p>
      ) : (
        <div className="flex max-w-lg flex-col gap-4">
          {tickets.map((t) => (
            <TicketStub key={t.position.pda} p={t.position} m={t.market} />
          ))}
        </div>
      )}
    </div>
  );
}
