import { defineConfig } from "vitest/config";

// Isolations- und Rechtetest (T-01 bis T-05) mit eigener Wegwerf-Datenbank: pnpm test:db
export default defineConfig({
  test: {
    include: ["src/**/*.db.test.ts"],
    environment: "node",
    fileParallelism: false,
    // Abbild laden, Container starten und alle Migrationen ausführen dauert beim ersten Mal.
    hookTimeout: 180_000,
    testTimeout: 60_000,
  },
});
