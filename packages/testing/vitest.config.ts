import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    // Tests mit eigener Datenbank laufen nur über vitest.db.config.ts (pnpm test:db).
    exclude: ["src/**/*.db.test.ts"],
    environment: "node",
  },
});
