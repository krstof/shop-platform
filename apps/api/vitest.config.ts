import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    environment: "node",
    // Datenbanktests teilen sich eine Wegwerf-Datenbank und laufen nacheinander.
    fileParallelism: false,
    // Ende-zu-Ende-Tests mit Datenbank und Bildumrechnung brauchen auf den CI-Rechnern mehr als 5 s.
    testTimeout: 20_000,
  },
});
