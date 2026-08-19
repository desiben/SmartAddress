import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["packages/**/*.test.ts", "conformance/**/*.test.ts"],
  },
  resolve: {
    alias: {
      "@smartaddress/core": new URL("./packages/core/src/index.ts", import.meta.url).pathname,
      "@smartaddress/data": new URL("./packages/data/src/index.ts", import.meta.url).pathname,
    },
  },
});
