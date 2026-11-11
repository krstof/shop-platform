// QR-Code als SVG-Pfad (M8, Zwei-Faktor einrichten). uqr rechnet die Matrix, wir zeichnen nur Quadrate.
// Kein Bild, kein Inline-Style: passt zur strengen Inhalts-Sicherheitsregel des Backoffice.
import { encode } from "uqr";

export interface QrPath {
  /** Kantenlänge mit Ruhezone, für viewBox. */
  readonly size: number;
  /** SVG-Pfad aller dunklen Felder. */
  readonly path: string;
}

/** Ruhezone von 4 Feldern rundherum, wie der Standard sie verlangt. */
const QUIET = 4;

export function qrPath(text: string): QrPath {
  const { size, data } = encode(text, { ecc: "M", border: 0 });
  let path = "";
  for (let y = 0; y < size; y++) {
    const row = data[y];
    if (row === undefined) continue;
    for (let x = 0; x < size; x++) if (row[x] === true) path += `M${x + QUIET} ${y + QUIET}h1v1h-1z`;
  }
  return { size: size + 2 * QUIET, path };
}

/** Geheimnis zum Abtippen in Vierergruppen (ABCD EFGH …). */
export function groupSecret(secret: string): string {
  return secret.replace(/(.{4})(?=.)/g, "$1 ");
}
