import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    environment: "node",
    // Datenbanktests teilen sich eine Wegwerf-Datenbank und laufen nacheinander.
    fileParallelism: false,
  },
});
