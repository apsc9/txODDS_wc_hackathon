"use client";

import * as anchor from "@coral-xyz/anchor";
import { useAnchorWallet, useConnection } from "@solana/wallet-adapter-react";
import { useMemo } from "react";

// Same static JSON the server-side poller imports (see src/server/chain.ts)
// — a bundler needs a static import to inline the IDL at build time, not a
// runtime fs read, so this uses the tracked copy at src/idl/fulltime.json.
import idl from "@/idl/fulltime.json";

// Signing client for the connected wallet — `null` whenever no wallet is
// connected (mirrors `useAnchorWallet()`'s own `undefined` for "no wallet"),
// so callers can branch on it directly instead of juggling `undefined` vs.
// `null` themselves.
export function useFulltimeProgram(): anchor.Program | null {
  const { connection } = useConnection();
  const wallet = useAnchorWallet();

  return useMemo(() => {
    if (!wallet) return null;
    const provider = new anchor.AnchorProvider(connection, wallet, { commitment: "confirmed" });
    return new anchor.Program(idl as anchor.Idl, provider);
  }, [connection, wallet]);
}
