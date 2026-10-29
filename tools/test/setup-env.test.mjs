// Tests für die Erzeugung der .env (Sicherheit 5.10).
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, statSync, copyFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { buildEnv, parseEnv, setupEnv } from "../setup-env.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

function freshDir() {
  const dir = mkdtempSync(join(tmpdir(), "shop-env-"));
  copyFileSync(join(root, ".env.example"), join(dir, ".env.example"));
  return dir;
}

test("ersetzt alle Platzhalter durch Zufallswerte", () => {
  const dir = freshDir();
  setupEnv(dir);
  const env = readFileSync(join(dir, ".env"), "utf8");
  const map = parseEnv(env);
  for (const [key, value] of map)
    assert.doesNotMatch(value, /__[A-Z0-9_]+__/, `${key} enthält noch einen Platzhalter`);
  assert.equal(map.get("SHOP_ENV"), "local");
  assert.match(map.get("GARAGE_RPC_SECRET") ?? "", /^[0-9a-f]{64}$/);
  assert.match(map.get("SHOP_S3_ACCESS_KEY_ID") ?? "", /^GK[0-9a-f]{24}$/);
  assert.equal(Buffer.from(map.get("SHOP_MASTER_KEY_V1") ?? "", "base64").length, 32);
  for (const key of ["POSTGRES_SUPERUSER_PASSWORD", "GARAGE_ADMIN_TOKEN", "MAILPIT_UI_PASSWORD"]) {
    assert.ok((map.get(key) ?? "").length >= 32, `${key} muss mindestens 32 Zeichen haben`);
  }
});

test("jeder Lauf erzeugt andere Geheimnisse", () => {
  const a = parseEnv(buildEnv("X=__SECRET__\nY=__HEX32__", "").content);
  const b = parseEnv(buildEnv("X=__SECRET__\nY=__HEX32__", "").content);
  assert.notEqual(a.get("X"), b.get("X"));
  assert.notEqual(a.get("Y"), b.get("Y"));
});

test("vorhandene Werte bleiben erhalten, neue Einträge werden ergänzt", () => {
  const { content, kept, generated } = buildEnv(
    "A=__SECRET__\nB=__SECRET__\nC=fest",
    "A=alterwert\nEIGEN=behalten\n",
  );
  const map = parseEnv(content);
  assert.equal(map.get("A"), "alterwert");
  assert.notEqual(map.get("B"), "__SECRET__");
  assert.equal(map.get("C"), "fest");
  assert.equal(map.get("EIGEN"), "behalten");
  assert.deepEqual(kept, ["A"]);
  assert.deepEqual(generated, ["B"]);
});

test("ein in .env stehen gebliebener Platzhalter wird ersetzt", () => {
  const map = parseEnv(buildEnv("A=__SECRET__", "A=__SECRET__").content);
  assert.notEqual(map.get("A"), "__SECRET__");
});

test(".env ist nur für den eigenen Nutzer lesbar", () => {
  const dir = freshDir();
  setupEnv(dir);
  assert.equal(statSync(join(dir, ".env")).mode & 0o777, 0o600);
});

test(".env wird von Git ignoriert, .env.example nicht", () => {
  /** @param {string} file */
  const ignored = (file) => {
    try {
      execFileSync("git", ["check-ignore", "-q", file], { cwd: root });
      return true;
    } catch {
      return false;
    }
  };
  assert.equal(ignored(".env"), true);
  assert.equal(ignored(".env.local"), true);
  assert.equal(ignored(".env.example"), false);
});

test("die Vorlage enthält keine echten Geheimnisse", () => {
  const map = parseEnv(readFileSync(join(root, ".env.example"), "utf8"));
  for (const [key, value] of map) {
    if (/PASSWORD|SECRET|TOKEN|MASTER_KEY/.test(key)) {
      assert.match(value, /^__[A-Z0-9_]+__$/, `${key} muss in .env.example ein Platzhalter sein`);
    }
  }
});

test("ein zweiter Lauf ändert nichts", () => {
  const dir = freshDir();
  setupEnv(dir);
  const first = readFileSync(join(dir, ".env"), "utf8");
  setupEnv(dir);
  assert.equal(readFileSync(join(dir, ".env"), "utf8"), first);
});
