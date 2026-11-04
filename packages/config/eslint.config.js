// Gemeinsame ESLint-Regeln (Architektur 3.4, Sicherheit 5.4 und 5.10).
// Weitere Regeln (set:html) kommen mit den jeweiligen Etappen dazu.
import js from "@eslint/js";
import tseslint from "typescript-eslint";
import globals from "globals";

const DB_MESSAGE = "Datenbankzugriff nur über withTenantTransaction aus @shop/kernel.";
const DRIVER_PATHS = [
  { name: "pg", message: DB_MESSAGE },
  { name: "postgres", message: DB_MESSAGE },
];
const RAW_SQL_MESSAGE =
  "Rohes SQL nur in Migrationen und im Kernel (Architektur 3.4). Abfragen mit dem typisierten Kysely-Baukasten bauen.";
const RAW_SQL_PATH = {
  name: "kysely",
  importNames: ["sql", "CompiledQuery", "RawNode"],
  message: RAW_SQL_MESSAGE,
};
const RAW_SQL_SYNTAX = [
  {
    selector: "ImportDeclaration[source.value='kysely'] > ImportNamespaceSpecifier",
    message: RAW_SQL_MESSAGE,
  },
  {
    selector: "ImportExpression[source.value='kysely']",
    message: RAW_SQL_MESSAGE,
  },
];

export default tseslint.config(
  {
    ignores: [
      "**/node_modules/**",
      "**/dist/**",
      "**/.turbo/**",
      "**/coverage/**",
      "**/.astro/**",
      "openapi/**",
      // Lokale Python-Umgebung für Schemathesis (pnpm test:fuzz)
      ".venv-fuzz/**",
      // Von kysely-codegen erzeugt (pnpm db:types)
      "**/db.generated.ts",
    ],
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
    // Tests mit Datenbank (Dienst migrate, *.db.test.ts) legen ihre Wegwerf-Datenbank selbst an.
    ignores: [
      "packages/kernel/**",
      "modules/**",
      "apps/migrate/src/**/*.test.ts",
      "apps/*/src/**/*.db.test.ts",
      // Testhilfen (nicht im gebauten Programm) und das Skript für Schemathesis
      "apps/*/src/testing/**",
      "apps/api/scripts/**",
    ],
    rules: {
      "no-restricted-imports": ["error", { paths: DRIVER_PATHS }],
    },
  },
  // Fachmodule: kein Treiber (außer identity) und kein rohes SQL (Architektur 3.4, Sicherheit 5.4).
  // Rohes SQL umgeht die Typprüfung je Modul und könnte fremde Tabellen lesen; es gehört nur
  // in Migrationen und den Kernel. Abfragen bauen Module mit dem typisierten Kysely-Baukasten.
  {
    files: ["modules/**/*.ts", "modules/**/*.tsx", "modules/**/*.js", "modules/**/*.mjs"],
    ignores: ["modules/identity/**"],
    rules: {
      "no-restricted-imports": ["error", { paths: [...DRIVER_PATHS, RAW_SQL_PATH] }],
      "no-restricted-syntax": ["error", ...RAW_SQL_SYNTAX],
    },
  },
  {
    files: ["modules/identity/**/*.ts", "modules/identity/**/*.js", "modules/identity/**/*.mjs"],
    rules: {
      "no-restricted-imports": ["error", { paths: [RAW_SQL_PATH] }],
      "no-restricted-syntax": ["error", ...RAW_SQL_SYNTAX],
    },
  },
);
