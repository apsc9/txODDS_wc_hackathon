"use client";

import { useAnchorWallet } from "@solana/wallet-adapter-react";
import { PublicKey } from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountIdempotentInstruction,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";
import { useCallback, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useFulltimeProgram } from "@/lib/anchor-client";
import { useMarkets } from "@/hooks/use-markets";
import { joinPositions, type Ticket } from "@/lib/positions";
import type { PositionDTO, MarketDTO } from "@/lib/types";

// ---------------------------------------------------------------------------
// usePositions — /api/positions?owner=<owner> joined client-side against the
// SSE-fed ["markets"] cache (use-markets.ts composition precedent, per the
// Task 16 brief's ambiguity resolution: "positions fetch (API) joined
// client-side against the SSE-fed markets cache so stub prices move live").
//
// Unlike ["markets"]/["scores"]/["feedUp"] (Task 9-13's staleTime: Infinity,
// SSE-push-only caches), positions have no SSE channel — nothing pushes a
// "position changed" event — so this stays a normal TanStack query with
// default staleTime/refetch behavior (refetch on mount/refocus is an
// event-driven React Query default, not a manual polling loop, so it doesn't
// run afoul of the "no browser polling loops" constraint that staleTime:
// Infinity was specifically there to satisfy for the SSE-fed caches).
// useClaim() below explicitly invalidates this query on a successful claim
// so a just-claimed ticket flips to "Claimed" without waiting on a refocus.
// ---------------------------------------------------------------------------
export function usePositions(owner: string | undefined, initial: MarketDTO[] = []) {
  const markets = useMarkets(undefined, initial);
  const { data: positions = [], isLoading, refetch } = useQuery({
    queryKey: ["positions", owner],
    queryFn: async (): Promise<PositionDTO[]> => {
      const res = await fetch(`/api/positions?owner=${owner}`);
      if (!res.ok) throw new Error("failed to fetch positions");
      const data = (await res.json()) as { positions: PositionDTO[] };
      return data.positions;
    },
    enabled: !!owner,
  });

  const tickets = useMemo(() => joinPositions(positions, markets), [positions, markets]);

  return { tickets, isLoading };
}

// ---------------------------------------------------------------------------
// mapClaimError — mapBuyError's (use-trade.ts) sibling for the claim path:
// same "never surface a raw error code alone" posture, mapped against the
// claim-specific Anchor errors in programs/fulltime/src/lib.rs
// (AlreadyClaimed 6015, NothingToClaim 6014) plus the same wallet-rejection
// case buy() handles.
// ---------------------------------------------------------------------------
type ErrLike = {
  message?: string;
  logs?: string[];
  error?: { errorCode?: { code?: string; number?: number } };
};

const FALLBACK_MSG_MAX = 120;

export function mapClaimError(err: unknown): string {
  const e = (err ?? {}) as ErrLike;
  const message = e.message ?? (typeof err === "string" ? err : String(err));
  const anchorCode = e.error?.errorCode?.code;
  const logs = Array.isArray(e.logs) ? e.logs.join(" ") : "";
  const haystack = `${message} ${logs}`;

  if (/user rejected|reject(ed)? the request|wallet.*reject/i.test(message)) {
    return "Claim cancelled in wallet";
  }
  if (anchorCode === "AlreadyClaimed" || /AlreadyClaimed/.test(haystack)) {
    return "Already claimed";
  }
  if (anchorCode === "NothingToClaim" || /NothingToClaim/.test(haystack)) {
    return "Nothing to claim — no winning shares";
  }

  const short =
    message.length > FALLBACK_MSG_MAX ? `${message.slice(0, FALLBACK_MSG_MAX)}…` : message;
  return `Claim failed — ${short}`;
}

// ---------------------------------------------------------------------------
// useClaim — builds and sends the exact instruction the brief specifies:
// program.methods.claim().accounts({claimer, market, position, vault,
// claimerToken, mint, tokenProgram}), mirroring use-trade.ts's buy()
// conventions: wallet/program acquisition via useFulltimeProgram(), the same
// idempotent-ATA pre-instruction (a claimer may not yet hold an ATA for this
// market's mint if they only ever bought the losing side of a different
// market), PDAs derived with the same seeds buy() already uses for
// vault/position (["vault", market] / ["position", market, owner] — this
// instruction's `claimer` fills the "owner" slot). On success, invalidates
// ["positions", owner] so the ticket's claimed flag refreshes without
// waiting on a refocus-triggered refetch.
// ---------------------------------------------------------------------------
export function useClaim() {
  const program = useFulltimeProgram();
  const wallet = useAnchorWallet();
  const queryClient = useQueryClient();

  const claim = useCallback(
    async (t: Ticket): Promise<string> => {
      if (!program || !wallet) {
        throw new Error("Connect a wallet to claim");
      }

      const claimer = wallet.publicKey;
      const marketPk = new PublicKey(t.market.pda);
      const mint = new PublicKey(t.market.mint);
      const [vault] = PublicKey.findProgramAddressSync(
        [Buffer.from("vault"), marketPk.toBuffer()],
        program.programId
      );
      const [position] = PublicKey.findProgramAddressSync(
        [Buffer.from("position"), marketPk.toBuffer(), claimer.toBuffer()],
        program.programId
      );
      const claimerToken = getAssociatedTokenAddressSync(mint, claimer);

      const createAtaIx = createAssociatedTokenAccountIdempotentInstruction(
        claimer,
        claimerToken,
        claimer,
        mint
      );

      const sig = await program.methods
        .claim()
        .accounts({
          claimer,
          market: marketPk,
          position,
          vault,
          claimerToken,
          mint,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .preInstructions([createAtaIx])
        .rpc();

      queryClient.invalidateQueries({ queryKey: ["positions", claimer.toBase58()] });

      return sig;
    },
    [program, wallet, queryClient]
  );

  return claim;
}
