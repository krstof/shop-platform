// Gemeinsame ESLint-Regeln (Architektur 3.4, Sicherheit 5.4 und 5.10).
// Weitere Regeln (rohes SQL, set:html, Modulgrenzen) kommen mit den jeweiligen Etappen dazu.
import js from "@eslint/js";
import tseslint from "typescript-eslint";
import globals from "globals";

export default tseslint.config(
  {
    ignores: ["**/node_modules/**", "**/dist/**", "**/.turbo/**", "**/coverage/**", "openapi/**"],
  },
  js.configs.recommended,
  ...tseslint.configs.strict,
  {
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: "module",
      globals: { ...globals.node },
    },
    rules: {
      // Zufall nur aus dem kryptografischen Generator (Sicherheit 5.10).
      "no-restricted-properties": [
        "error",
        {
          object: "Math",
          property: "random",
          message: "Nur crypto.randomBytes oder crypto.randomUUID verwenden (Sicherheit 5.10).",
        },
      ],
      // Kein dynamisch ausgeführter Code.
      "no-eval": "error",
      "no-implied-eval": "error",
      "no-new-func": "error",
      eqeqeq: ["error", "always"],
    },
  },
  // Einziger Weg zur Datenbank ist withTenantTransaction aus dem Kernel (Architektur 5.3).
  // Den Treiber direkt benutzen dürfen nur der Kernel und das Anmeldemodul (ADR-008).
  {
    files: ["**/*.ts", "**/*.tsx", "**/*.js", "**/*.mjs"],
    // Der Test des Dienstes migrate legt seine Wegwerf-Datenbank selbst an.
    ignores: ["packages/kernel/**", "modules/identity/**", "apps/migrate/src/**/*.test.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            { name: "pg", message: "Datenbankzugriff nur über withTenantTransaction aus @shop/kernel." },
            {
              name: "postgres",
              message: "Datenbankzugriff nur über withTenantTransaction aus @shop/kernel.",
            },
          ],
        },
      ],
    },
  },
);
