"use client";

import { useEffect, useState } from "react";
import { WalletMultiButton } from "@solana/wallet-adapter-react-ui";

// Truncated pubkey ("7xKp..3Fq"), the connect modal, and the connected
// dropdown (copy address / change wallet / disconnect) all come from the
// library itself — only the visual theme is ours, applied in globals.css
// via a `.ft-wallet` wrapper (NOT a `className` prop on WalletMultiButton:
// BaseWalletConnectionButton hardcodes its own className after spreading
// props, so a caller-supplied className is silently dropped — confirmed
// against the installed 0.9.36 build) to the FullTime palette per the
// approved mockup's connected-wallet pill
// (.superpowers/brainstorm/20358-1783435793/content/fixture-page-v4.html).
export function WalletButton() {
  // Mount gate: the button's content depends on wallet state that exists
  // only in the browser (autoConnect resolves before hydration), so
  // server-rendering WalletMultiButton ("Select Wallet") mismatches the
  // client's first paint whenever a wallet is already connected — a
  // recoverable-but-noisy Next.js hydration failure. Render the themed
  // slot empty on the server and swap the real button in after mount.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  return <div className="ft-wallet">{mounted ? <WalletMultiButton /> : null}</div>;
}
