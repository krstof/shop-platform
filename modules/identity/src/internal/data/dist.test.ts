// Die Liste bekannter Passwörter muss auch im gebauten Modul liegen (Container-Abbild, apps/api).
import { existsSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const root = join(dirname(fileURLToPath(import.meta.url)), "../../..");

describe.skipIf(!existsSync(join(root, "dist")))("gebautes Modul identity", () => {
  it("enthält die Liste bekannter Passwörter neben password.js", () => {
    const built = join(root, "dist/internal/data/common-passwords.txt.gz");
    const source = join(root, "src/internal/data/common-passwords.txt.gz");
    expect(existsSync(join(root, "dist/internal/password.js"))).toBe(true);
    expect(statSync(built).size).toBe(statSync(source).size);
  });
});
