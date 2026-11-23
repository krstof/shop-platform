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
 * Die Muster im Caddyfile: @video (Produktvideo), @upload (Bilder und Chat-Fotos), @not_upload
 * (alles andere) und die beiden Muster in der Vorab-Ablehnung @too_large.
 * @returns {{ video: string | undefined, upload: string | undefined, notUpload: string | undefined, expression: string[] }}
 */
function uploadPatterns() {
  /** @param {string} name @returns {string | undefined} */
  const matcher = (name) => new RegExp(`^\\t@${name} (?:not )?path_regexp (\\S+)$`, "m").exec(caddyfile)?.[1];
  const expression = [...caddyfile.matchAll(/\{http\.request\.uri\.path\}\.matches\("([^"]+)"\)/g)].flatMap(
    (m) => (m[1] === undefined ? [] : [m[1]]),
  );
  return {
    video: matcher("video"),
    upload: matcher("upload"),
    notUpload: matcher("not_upload"),
    expression,
  };
}

/** Muster, das alle Endpunkte mit großem Körper trifft (Video oder Bild). @returns {RegExp} */
function uploadPattern() {
  const { video, upload } = uploadPatterns();
  assert.ok(video !== undefined && upload !== undefined, "Matcher @video und @upload erwartet");
  return new RegExp(`(?:${video})|(?:${upload})`);
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

test("Caddy nennt dieselben Pfade in Matcher und Vorab-Ablehnung", () => {
  const { video, upload, notUpload, expression } = uploadPatterns();
  assert.ok(video !== undefined && upload !== undefined, "Matcher @video und @upload erwartet");
  assert.ok(notUpload !== undefined, "Matcher @not_upload erwartet");
  assert.deepEqual(expression, [video, upload], "@too_large muss erst das Video, dann die Bilder prüfen");
  // @not_upload ist das Gegenstück: Es darf keinen Pfad treffen, der schon groß sein darf.
  const gross = new RegExp(`(?:${video})|(?:${upload})`);
  const id = "11111111-2222-4333-8444-555555555555";
  for (const pfad of [
    `/admin/v1/products/${id}/video`,
    `/admin/v1/products/${id}/images`,
    `/admin/v1/design/logo`,
    `/admin/v1/assistant/chat`,
  ]) {
    assert.ok(gross.test(pfad), `${pfad} soll groß sein dürfen`);
    assert.ok(new RegExp(notUpload).test(pfad), `${pfad} fehlt im Gegenstück @not_upload`);
  }
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
    assert.ok(!pattern.test(path), `${path} braucht keinen großen Körper`);
});
