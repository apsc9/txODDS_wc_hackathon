"use client";

import * as anchor from "@coral-xyz/anchor";
import { useAnchorWallet, useConnection } from "@solana/wallet-adapter-react";
import { Connection, Keypair } from "@solana/web3.js";
import { useMemo } from "react";

// Same static JSON the server-side poller imports (see src/server/chain.ts)
// — a bundler needs a static import to inline the IDL at build time, not a
// runtime fs read, so this reuses the copy already checked in at
// src/idl/fulltime.json rather than reaching outside `src/` into
// `target/idl/` the way the server module does.
import idl from "@/idl/fulltime.json";

// Read-only client for pages/components with no connected wallet: a
// freshly generated `Keypair` never signs anything (only `.account.x.all()`
// / `.fetch()` reads are made through it), mirroring the dummy-wallet
// pattern `getProgram()` uses server-side in src/server/chain.ts.
export function readonlyProgram(connection: Connection): anchor.Program {
  const wallet = new anchor.Wallet(Keypair.generate());
  const provider = new anchor.AnchorProvider(connection, wallet, { commitment: "confirmed" });
  return new anchor.Program(idl as anchor.Idl, provider);
}

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
