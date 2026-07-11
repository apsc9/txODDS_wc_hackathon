"use client";

import { ConnectionProvider, WalletProvider } from "@solana/wallet-adapter-react";
import { WalletModalProvider } from "@solana/wallet-adapter-react-ui";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import { useStream } from "@/hooks/use-stream";

import "@solana/wallet-adapter-react-ui/styles.css";

// Mounted once, inside QueryClientProvider below, so useStream() has access
// to the same QueryClient it writes SSE updates into. Renders nothing of
// its own — exists purely to call the hook at the top of the tree, per the
// brief ("mounts once inside <Providers>").
function StreamBoot({ children }: { children: ReactNode }) {
  useStream();
  return <>{children}</>;
}

// Matches apps/web/.env.local.example — falls back to the public devnet RPC
// so local dev works without an .env.local (same convention as the server
// poller's RPC_URL in src/server/chain.ts).
const RPC_ENDPOINT = process.env.NEXT_PUBLIC_RPC ?? "https://api.devnet.solana.com";

// `wallets={[]}`: no adapter packages are registered explicitly — every
// wallet-standard extension (Phantom, Backpack, Solflare, ...) registers
// itself with the browser automatically, and WalletProvider picks those up
// on its own.
export function Providers({ children }: { children: ReactNode }) {
  // Created once per mount (not per render) so query cache identity is
  // stable across re-renders, and lazily via useState so it isn't
  // reconstructed — and its cache dropped — on every render.
  const [queryClient] = useState(() => new QueryClient());

  return (
    <ConnectionProvider endpoint={RPC_ENDPOINT}>
      <WalletProvider wallets={[]} autoConnect>
        <WalletModalProvider>
          <QueryClientProvider client={queryClient}>
            <StreamBoot>{children}</StreamBoot>
          </QueryClientProvider>
        </WalletModalProvider>
      </WalletProvider>
    </ConnectionProvider>
  );
}
