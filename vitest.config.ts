import { resolve } from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      obsidian: resolve(__dirname, "tests/support/obsidian.ts"),
    },
  },
  test: {
    environment: "jsdom",
    globals: true,
    include: ["tests/**/*.spec.ts"],
  },
});
