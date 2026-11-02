#!/usr/bin/env node
// shop-testdb: startet eine Wegwerf-Datenbank und führt einen Befehl damit aus.
// Wird von pnpm test:with-db und pnpm db:types benutzt (über tools/testdb.mjs).
import { spawn } from "node:child_process";
import { parseArgs, USAGE, type CliCommand } from "./cli-args.js";
import { startTestDatabase } from "./postgres.js";

function run(command: string[], env: NodeJS.ProcessEnv): Promise<number> {
  const [cmd = "", ...args] = command;
  return new Promise((done) => {
    const child = spawn(cmd, args, { cwd: process.cwd(), env, stdio: "inherit" });
    child.on("error", (err) => {
      console.error(`Befehl nicht ausführbar: ${err.message}`);
      done(127);
    });
    child.on("exit", (code, signal) => done(code ?? (signal ? 1 : 0)));
  });
}

async function main(): Promise<number> {
  let parsed: CliCommand;
  try {
    parsed = parseArgs(process.argv.slice(2));
  } catch (err) {
    console.error(`${(err as Error).message}\n\n${USAGE}`);
    return 2;
  }
  const db = await startTestDatabase();
  const stopOnSignal = (): void => {
    void db.stop().finally(() => process.exit(130));
  };
  process.once("SIGINT", stopOnSignal);
  process.once("SIGTERM", stopOnSignal);
  try {
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      SHOP_TEST_DATABASE_URL: db.adminUrl(),
      SHOP_REQUIRE_DB_TESTS: "true",
    };
    if (parsed.kind === "migrated") env[parsed.envVar] = await db.migrate(parsed.database);
    return await run(parsed.command, env);
  } finally {
    await db.stop();
  }
}

main().then(
  (code) => process.exit(code),
  (err: unknown) => {
    console.error(`Wegwerf-Datenbank: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  },
);
