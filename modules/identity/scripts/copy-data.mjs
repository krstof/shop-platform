// Kopiert die Liste bekannter Passwörter neben den gebauten Code (dist/internal/data).
// password.ts lädt sie relativ zu sich selbst; ohne diesen Schritt fehlte sie im Container-Abbild
// und überall, wo das Modul gebaut statt aus dem Quellcode läuft (gefunden mit E6 Teil 2).
import { cpSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const target = join(root, "dist/internal/data");
mkdirSync(target, { recursive: true });
cpSync(join(root, "src/internal/data/common-passwords.txt.gz"), join(target, "common-passwords.txt.gz"));
