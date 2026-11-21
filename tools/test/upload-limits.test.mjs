// Grenzen fürs Hochladen (21.11.2026): Caddy lässt für Upload-Pfade 12 MB durch, für alles andere
// 1 MB. Diese Liste steht in infra/caddy/Caddyfile, die echte Grenze je Endpunkt in der API
// (bodyLimit). Laufen beide auseinander, weist Caddy ein Bild mit 413 ab, obwohl die API es annehmen
// würde — genau der Fehler „Die Anfrage ist zu groß“ beim Logo, Kategoriebild und Chat-Foto.
// Dieser Test hält beide Seiten zusammen: Grundlage ist openapi/admin.json, wo die Beschreibung des
// 413 die Grenze des Endpunkts nennt („Die Anfrage ist größer als 12 MB.“).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { repoRoot } from "../lib/modules.mjs";

const caddyfile = readFileSync(join(repoRoot, "infra/caddy/Caddyfile"), "utf8");
/** @type {{ paths: Record<string, Record<string, { responses?: Record<string, { description?: string }> }>> }} */
const spec = JSON.parse(readFileSync(join(repoRoot, "openapi/admin.json"), "utf8"));

/**
 * Die drei Stellen im Caddyfile, die den Upload-Pfad nennen (Matcher, Gegenstück, Vorab-Ablehnung).
 * @returns {{ matchers: string[], expression: string | undefined }}
 */
function uploadPatterns() {
  const matchers = [...caddyfile.matchAll(/^\t@(?:not_)?upload (?:not )?path_regexp (\S+)$/gm)].flatMap(
    (m) => (m[1] === undefined ? [] : [m[1]]),
  );
  const expression = /\{http\.request\.uri\.path\}\.matches\("([^"]+)"\)/.exec(caddyfile)?.[1];
  return { matchers, expression };
}

/** Das Muster des Matchers @upload als Regex. @returns {RegExp} */
function uploadPattern() {
  const [first] = uploadPatterns().matchers;
  assert.ok(first !== undefined, "Matcher @upload nicht im Caddyfile gefunden");
  return new RegExp(first);
}

/** Pfade der Admin-API, deren Endpunkt mehr als 1 MB annimmt. @returns {string[]} */
function largeBodyPaths() {
  /** @type {string[]} */
  const paths = [];
  /** @type {Record<string, Record<string, { responses?: Record<string, { description?: string }> }>>} */
  const items = spec.paths;
  for (const [path, item] of Object.entries(items)) {
    for (const operation of Object.values(item)) {
      const description = operation.responses?.["413"]?.description ?? "";
      const mb = /größer als (\d+) MB/.exec(description)?.[1];
      if (mb !== undefined && Number(mb) > 1) paths.push(path);
    }
  }
  return [...new Set(paths)];
}

test("Caddy nennt den Upload-Pfad an allen drei Stellen gleich", () => {
  const { matchers, expression } = uploadPatterns();
  assert.equal(matchers.length, 2, "Matcher @upload und @not_upload erwartet");
  assert.ok(expression !== undefined, "Vorab-Ablehnung @too_large erwartet");
  assert.deepEqual(new Set([...matchers, expression]).size, 1, "alle drei Stellen müssen gleich sein");
});

test("Caddy lässt genau die Endpunkte groß durch, die die API groß annimmt", () => {
  const pattern = uploadPattern();
  const paths = largeBodyPaths();
  assert.ok(paths.length >= 4, `zu wenige Upload-Endpunkte gefunden: ${paths.length}`);
  const id = "11111111-2222-4333-8444-555555555555";
  for (const path of paths) {
    const concrete = path.replaceAll(/\{[^}]+\}/g, id);
    assert.ok(pattern.test(concrete), `Caddy begrenzt ${concrete} auf 1 MB, die API nimmt mehr an`);
  }
});

test("Caddy lässt gewöhnliche Endpunkte nicht groß durch", () => {
  const pattern = uploadPattern();
  for (const path of ["/admin/v1/products", "/admin/v1/orders", "/admin/v1/design/draft", "/admin/v1/me"])
    assert.ok(!pattern.test(path), `${path} braucht keine 12 MB`);
});
