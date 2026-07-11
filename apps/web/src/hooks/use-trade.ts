"use client";

import * as anchor from "@coral-xyz/anchor";
import { useAnchorWallet } from "@solana/wallet-adapter-react";
import { PublicKey, SystemProgram } from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountIdempotentInstruction,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";
import { useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useFulltimeProgram } from "@/lib/anchor-client";
import { poolsAfterBuy, sharesOut, impliedProbPpm } from "@/lib/fpmm";
import type { MarketDTO } from "@/lib/types";

export type Side = "YES" | "NO";

export type Quote = {
  shares: bigint;
  avgPriceCents: number;
  payout: bigint;
};

// ---------------------------------------------------------------------------
// quote — pure, local FPMM math (Task 2's src/lib/fpmm.ts). No network I/O,
// so this is safe to call on every keystroke (<100ms per Global
// Constraints). Extracted as a plain function (not a hook) per the brief so
// it's unit-testable without React — see tests/use-trade.test.ts.
// ---------------------------------------------------------------------------
export function quote(m: MarketDTO, side: Side, amountIn: bigint): Quote | null {
  if (amountIn <= 0n) return null;

  const poolYes = BigInt(m.poolYes);
  const poolNo = BigInt(m.poolNo);
  const poolThis = side === "YES" ? poolYes : poolNo;
  const poolOther = side === "YES" ? poolNo : poolYes;

  const shares = sharesOut(poolThis, poolOther, amountIn);
  if (shares === null || shares <= 0n) return null;

  // Display-only ratio (avg cents paid per share) — integer bigint division,
  // truncated. Never used for on-chain amounts.
  const avgPriceCents = Number((amountIn * 100n) / shares);

  // 1:1 redemption per brief: a winning share redeems for 1 stake-token.
  return { shares, avgPriceCents, payout: shares };
}

// ---------------------------------------------------------------------------
// mapBuyError — translate program/wallet errors into the exact copy the
// brief specifies. Never surfaces a raw error code by itself; the fallback
// always carries the "Trade not placed — " prefix plus a short message.
// ---------------------------------------------------------------------------
type ErrLike = {
  message?: string;
  logs?: string[];
  error?: { errorCode?: { code?: string; number?: number } };
};

const FALLBACK_MSG_MAX = 120;

export function mapBuyError(err: unknown): string {
  const e = (err ?? {}) as ErrLike;
  const message = e.message ?? (typeof err === "string" ? err : String(err));
  const anchorCode = e.error?.errorCode?.code;
  const logs = Array.isArray(e.logs) ? e.logs.join(" ") : "";
  const haystack = `${message} ${logs}`;

  if (/user rejected|reject(ed)? the request|wallet.*reject/i.test(message)) {
    return "Trade cancelled in wallet";
  }
  if (anchorCode === "SlippageExceeded" || /SlippageExceeded/.test(haystack)) {
    return "Trade not placed — price moved past your slippage limit";
  }
  if (/\b0x1\b/.test(haystack) || /insufficient funds/i.test(haystack)) {
    return "Trade not placed — not enough test USDC in wallet";
  }

  const short =
    message.length > FALLBACK_MSG_MAX ? `${message.slice(0, FALLBACK_MSG_MAX)}…` : message;
  return `Trade not placed — ${short}`;
}

// ---------------------------------------------------------------------------
// useTrade — quote (above) + buy(), the signing/submit path. buy() builds
// the exact instruction the on-chain program.buy() expects (PDAs per Global
// Constraints: market ["market", creator, marketId], vault ["vault",
// market], position ["position", market, owner]), patches the ["markets"]
// TanStack cache optimistically with the post-buy pools before the tx is
// even sent, and rolls that patch back if the send/confirm fails.
// ---------------------------------------------------------------------------
export function useTrade() {
  const program = useFulltimeProgram();
  const wallet = useAnchorWallet();
  const queryClient = useQueryClient();

  const buy = useCallback(
    async (m: MarketDTO, side: Side, amountIn: bigint, minSharesOut: bigint): Promise<string> => {
      if (!program || !wallet) {
        throw new Error("Connect a wallet to place a trade");
      }

      const poolYes = BigInt(m.poolYes);
      const poolNo = BigInt(m.poolNo);
      const poolThis = side === "YES" ? poolYes : poolNo;
      const poolOther = side === "YES" ? poolNo : poolYes;
      const shares = sharesOut(poolThis, poolOther, amountIn);
      if (shares === null) throw new Error("Trade not placed — quote unavailable");

      const [newThis, newOther] = poolsAfterBuy(poolThis, poolOther, amountIn, shares);
      const newPoolYes = side === "YES" ? newThis : newOther;
      const newPoolNo = side === "YES" ? newOther : newThis;
      const newYesPpm = impliedProbPpm(newPoolYes, newPoolNo) ?? m.yesPpm;

      // Snapshot for rollback, then apply the optimistic patch immediately —
      // before the tx is even sent — so the row shifts on click, not on
      // confirm (the poller reconciles the real value within ~2s; this
      // patch just anticipates it).
      const previous = queryClient.getQueryData<MarketDTO[]>(["markets"]);
      queryClient.setQueryData<MarketDTO[]>(["markets"], (old) =>
        (old ?? []).map((mm) =>
          mm.pda === m.pda
            ? { ...mm, poolYes: newPoolYes.toString(), poolNo: newPoolNo.toString(), yesPpm: newYesPpm }
            : mm
        )
      );

      try {
        const buyer = wallet.publicKey;
        const marketPk = new PublicKey(m.pda);
        const mint = new PublicKey(m.mint);
        const [vault] = PublicKey.findProgramAddressSync(
          [Buffer.from("vault"), marketPk.toBuffer()],
          program.programId
        );
        const [position] = PublicKey.findProgramAddressSync(
          [Buffer.from("position"), marketPk.toBuffer(), buyer.toBuffer()],
          program.programId
        );
        const buyerToken = getAssociatedTokenAddressSync(mint, buyer);

        const createAtaIx = createAssociatedTokenAccountIdempotentInstruction(
          buyer,
          buyerToken,
          buyer,
          mint
        );

        const sideArg = side === "YES" ? { yes: {} } : { no: {} };

        const sig = await program.methods
          .buy(sideArg, new anchor.BN(amountIn.toString()), new anchor.BN(minSharesOut.toString()))
          .accounts({
            buyer,
            market: marketPk,
            position,
            vault,
            buyerToken,
            mint,
            tokenProgram: TOKEN_PROGRAM_ID,
            systemProgram: SystemProgram.programId,
          })
          .preInstructions([createAtaIx])
          .rpc();

        return sig;
      } catch (err) {
        // Roll back the optimistic patch — the trade never landed.
        queryClient.setQueryData(["markets"], previous);
        throw err;
      }
    },
    [program, wallet, queryClient]
  );

  return { quote, buy };
}
