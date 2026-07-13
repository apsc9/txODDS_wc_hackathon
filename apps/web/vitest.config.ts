import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      // "server-only" throws when imported outside a react-server bundling
      // context; under vitest (plain Node) it would blow up on import, so
      // alias it to its own no-op "react-server" build for tests.
      "server-only": path.resolve(__dirname, "node_modules/server-only/empty.js"),
      // Mirrors tsconfig.json's "@/*" -> "./src/*" path alias (Next.js
      // resolves it natively; vitest needs it spelled out explicitly).
      "@": path.resolve(__dirname, "src"),
    },
  },
  // tsconfig.json uses "jsx": "preserve" (Next.js transforms JSX itself), so
  // esbuild falls back to the classic React.createElement runtime under
  // vitest — which breaks importing any .tsx module (e.g. the fixture page
  // RSC in tests/fixture-page.test.ts) with "React is not defined". Pin the
  // automatic runtime, matching what Next.js compiles with.
  esbuild: { jsx: "automatic" },
  test: {
    include: ["tests/**/*.test.ts"]
  }
});
