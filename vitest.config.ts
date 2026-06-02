import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL(".", import.meta.url)),
      "server-only": fileURLToPath(
        new URL("./tests/shims/server-only.ts", import.meta.url)
      ),
    },
  },
  test: {
    environment: "node",
    include: ["**/*.test.ts"],
    exclude: ["node_modules", ".next", "dist"],
    coverage: {
      provider: "v8",
      reporter: ["text", "html"],
    },
  },
});

