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
  test: {
    include: ["tests/**/*.test.ts"]
  }
});
