// Startet die lokale Plattform mit einem Befehl (BET-02, Architektur 7.2).
//   pnpm dev       .env anlegen oder ergänzen, eigene Abbilder bauen, Container starten
//                  (darin legt der Dienst migrate die Datenbank an und führt alle Migrationen aus,
//                  danach starten API und Worker), Objektspeicher einrichten
//   pnpm dev:down  Container stoppen (Daten bleiben erhalten)
//   pnpm dev:seed  Testshops Teeladen und Modeladen mit Inhaberkonto anlegen (M1, läuft in der API)
import { execFileSync } from "node:child_process";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";
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

/**
 * Baut die eigenen Abbilder (infra/docker/Dockerfile). Hinter einem Proxy auf dem eigenen Rechner
 * (zum Beispiel in einer Cloud-Sitzung) helfen zwei freiwillige Einstellungen aus der Umgebung:
 * SHOP_BUILD_NETWORK=host und SHOP_BUILD_CA_FILE=<Zertifikat des Proxys>. Das Zertifikat wird nur
 * beim Bauen eingebunden und landet nie im Abbild.
 */
function buildImages() {
  for (const target of ["migrate", "api", "worker"]) {
    const args = ["build", "-f", resolve(root, "infra/docker/Dockerfile"), "--target", target];
    args.push("-t", `shop-platform/${target}:local`);
    if (process.env.SHOP_BUILD_NETWORK) args.push("--network", process.env.SHOP_BUILD_NETWORK);
    if (process.env.SHOP_BUILD_CA_FILE)
      args.push("--secret", `id=extra_ca,src=${process.env.SHOP_BUILD_CA_FILE}`);
    for (const name of ["HTTP_PROXY", "HTTPS_PROXY", "NO_PROXY"]) {
      if (process.env[name]) args.push("--build-arg", name);
    }
    execFileSync("docker", [...args, root], { cwd: root, stdio: ["ignore", "inherit", "inherit"] });
  }
}

const command = process.argv[2] ?? "up";
if (command === "down") {
  docker(["down"]);
  console.log("Plattform gestoppt. Die Daten bleiben erhalten.");
} else if (command === "seed") {
  const seedArgs = ["exec", "-T"];
  if (process.env.SHOP_SEED_PASSWORD) seedArgs.push("-e", "SHOP_SEED_PASSWORD");
  process.stdout.write(docker([...seedArgs, "api", "node", "dist/seed.js"]));
} else {
  setupEnv(root);
  const env = parseEnv(readFileSync(resolve(root, ".env"), "utf8"));
  console.log("Baue Abbilder …");
  // Abbilder bei jedem Start neu bauen (dank Zwischenspeicher meist in Sekunden), damit sie zum Code passen.
  buildImages();
  console.log("Starte Container (Datenbank wird eingerichtet) …");
  docker(["up", "-d", "--no-build", "--wait", "--remove-orphans"]);
  // Caddy hat keine Verwaltungsschnittstelle, geänderte Regeln wirken erst nach Neustart.
  docker(["restart", "caddy"], { quiet: true });
  console.log("Richte Objektspeicher ein …");
  initGarage(env);
  const d = env.get("SHOP_DOMAIN") ?? "localhost";
  console.log(`
Die Plattform läuft:
  Startseite   https://${d}
  API          https://api.${d}   (Beschreibung in openapi/)
  Test-Mails   https://mail.${d}   (Anmeldung: ${env.get("MAILPIT_UI_USER")} / Passwort steht in .env)
  Bilder       https://media.${d}
`);
}
