// Startet die lokale Plattform mit einem Befehl (BET-02, Architektur 7.2).
//   pnpm dev       .env anlegen oder ergänzen, Container starten, Objektspeicher einrichten,
//                  Datenbank anlegen und alle Migrationen ausführen (Dienst migrate)
//   pnpm dev:down  Container stoppen (Daten bleiben erhalten)
import { execFileSync } from "node:child_process";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync, readFileSync } from "node:fs";
import { setupEnv, parseEnv } from "./setup-env.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const composeArgs = [
  "compose",
  "--project-directory",
  resolve(root, "infra"),
  "-f",
  resolve(root, "infra/compose.yaml"),
  "-f",
  resolve(root, "infra/compose.local.yaml"),
  "--env-file",
  resolve(root, ".env"),
];

/** @param {string[]} args @param {{ quiet?: boolean }} [opts] */
function docker(args, opts = {}) {
  return execFileSync("docker", [...composeArgs, ...args], {
    cwd: root,
    encoding: "utf8",
    stdio: opts.quiet ? ["ignore", "pipe", "pipe"] : ["ignore", "pipe", "inherit"],
  });
}

/** @param {string[]} args */
function garage(args) {
  return docker(["exec", "-T", "garage", "/garage", ...args], { quiet: true });
}

/** Richtet den Objektspeicher ein. Jeder Schritt darf mehrfach laufen. @param {Map<string,string>} env */
function initGarage(env) {
  const status = garage(["status"]);
  const nodeId = /^([0-9a-f]{16})\s/m.exec(status)?.[1];
  if (!nodeId) throw new Error("Garage: Knoten-ID nicht gefunden.");
  const layout = garage(["layout", "show"]);
  if (/No nodes currently have a role/i.test(layout) || !layout.includes(nodeId.slice(0, 16))) {
    garage(["layout", "assign", "-z", "local", "-c", "10G", nodeId]);
    const version = Number(/Current cluster layout version:\s*(\d+)/i.exec(layout)?.[1] ?? "0") + 1;
    garage(["layout", "apply", "--version", String(version)]);
  }
  const keyId = env.get("SHOP_S3_ACCESS_KEY_ID") ?? "";
  const secret = env.get("SHOP_S3_SECRET_ACCESS_KEY") ?? "";
  const keys = garage(["key", "list"]);
  if (!keys.includes(keyId)) garage(["key", "import", "--yes", "-n", "shop-app", keyId, secret]);
  const buckets = garage(["bucket", "list"]);
  for (const name of [env.get("SHOP_S3_BUCKET_PUBLIC") ?? "", env.get("SHOP_S3_BUCKET_PRIVATE") ?? ""]) {
    if (!new RegExp(`\\b${name}\\b`).test(buckets)) garage(["bucket", "create", name]);
    garage(["bucket", "allow", "--read", "--write", name, "--key", keyId]);
  }
  // Nur der öffentliche Speicher wird als Webseite ausgeliefert (media.localhost).
  garage(["bucket", "website", "--allow", env.get("SHOP_S3_BUCKET_PUBLIC") ?? ""]);
}

/** Baut den Dienst migrate (falls nötig) und führt ihn gegen die lokale Datenbank aus. @param {Map<string,string>} env */
function migrate(env) {
  if (!existsSync(resolve(root, "node_modules"))) {
    execFileSync("pnpm", ["install", "--frozen-lockfile"], { cwd: root, stdio: "inherit" });
  }
  execFileSync("pnpm", ["-s", "--filter", "@shop/migrate...", "-r", "run", "build"], {
    cwd: root,
    stdio: "inherit",
  });
  const url = new URL(`postgres://127.0.0.1:${env.get("SHOP_DB_PORT") ?? "5432"}/`);
  url.username = "postgres";
  url.password = env.get("POSTGRES_SUPERUSER_PASSWORD") ?? "";
  url.pathname = `/${env.get("SHOP_DB_NAME") ?? "shop"}`;
  const vars = Object.fromEntries([...env].filter(([k]) => k.startsWith("SHOP_DB_PASSWORD_")));
  execFileSync("node", [resolve(root, "apps/migrate/dist/main.js")], {
    cwd: root,
    stdio: "inherit",
    env: {
      ...process.env,
      ...vars,
      SHOP_ENV: env.get("SHOP_ENV") ?? "local",
      SHOP_MIGRATE_DATABASE_URL: url.href,
      SHOP_MIGRATE_CREATE_DATABASE: "true",
    },
  });
}

const command = process.argv[2] ?? "up";
if (command === "down") {
  docker(["down"]);
  console.log("Plattform gestoppt. Die Daten bleiben erhalten.");
} else {
  setupEnv(root);
  const env = parseEnv(readFileSync(resolve(root, ".env"), "utf8"));
  console.log("Starte Container …");
  docker(["up", "-d", "--wait", "--remove-orphans"]);
  // Caddy hat keine Verwaltungsschnittstelle, geänderte Regeln wirken erst nach Neustart.
  docker(["restart", "caddy"], { quiet: true });
  console.log("Richte Objektspeicher ein …");
  initGarage(env);
  console.log("Richte Datenbank ein …");
  migrate(env);
  const d = env.get("SHOP_DOMAIN") ?? "localhost";
  console.log(`
Die Plattform läuft:
  Startseite   https://${d}
  Test-Mails   https://mail.${d}   (Anmeldung: ${env.get("MAILPIT_UI_USER")} / Passwort steht in .env)
  Bilder       https://media.${d}
`);
}
