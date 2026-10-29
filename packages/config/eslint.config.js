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
);
