import type { Metadata } from "next";
import { Barlow_Condensed, IBM_Plex_Mono, Archivo } from "next/font/google";
import { Providers } from "@/components/providers";
import { SiteNav } from "@/components/site-nav";
import "./globals.css";

const barlowCondensed = Barlow_Condensed({
  weight: ["500", "600", "700"],
  subsets: ["latin"],
  variable: "--font-display"
});

const ibmPlexMono = IBM_Plex_Mono({
  weight: ["400", "500", "600"],
  subsets: ["latin"],
  variable: "--font-mono"
});

const archivo = Archivo({
  weight: ["400", "500", "600"],
  subsets: ["latin"],
  variable: "--font-body"
});

export const metadata: Metadata = {
  title: "FULLTIME",
  description: "Prediction market for World Cup matches"
};

export default function RootLayout({
  children
}: {
  children: React.ReactNode;
}) {
  return (
    <html
      lang="en"
      className={`${barlowCondensed.variable} ${ibmPlexMono.variable} ${archivo.variable}`}
    >
      <body className="flex flex-col min-h-screen">
        {/* Providers wraps SiteNav too, not just {children}: SiteNav
            renders <WalletButton/>, which needs the wallet/connection/query
            context from below. */}
        <Providers>
          <SiteNav />
          <main className="flex-1 px-6 py-8">
            {children}
          </main>
          <footer className="border-t border-[var(--line)] px-6 py-4 text-[var(--t4)] text-xs font-mono-num">
            devnet only · test tokens · not gambling — a settlement-verification demo
          </footer>
        </Providers>
      </body>
    </html>
  );
}
