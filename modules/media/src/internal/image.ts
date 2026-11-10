// Bild prüfen und umrechnen (M2 Teil 2, Sicherheit 5.7). Nur JPEG, PNG und WebP, erkannt an den
// ersten Bytes (nicht am Dateinamen). SVG, GIF, TIFF, HEIC & Co. werden abgelehnt, bevor sharp sie
// überhaupt öffnet. Ausgeliefert werden nur neu berechnete WebP-Fassungen ohne Zusatzdaten
// (EXIF mit GPS-Ort, Kameradaten), das Original bleibt im privaten Speicher.
import { createHash } from "node:crypto";
import sharp from "sharp";

/** Höchstgröße einer hochgeladenen Datei (8 MB, reicht für Handyfotos). */
export const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
/** Höchstens 40 Megapixel: schützt vor „Pixelbomben“ (kleine Datei, riesiges Bild). */
const MAX_PIXELS = 40_000_000;
/** Mindestens 32 Pixel je Seite, sonst ist es kein brauchbares Produktbild. */
const MIN_SIDE = 32;

export type ImageFormat = "jpeg" | "png" | "webp";

const MIME: Record<ImageFormat, string> = { jpeg: "image/jpeg", png: "image/png", webp: "image/webp" };

/** Fassungen, die ausgeliefert werden (Architektur: Presets in media_rendition). */
export const RENDITIONS = [
  { preset: "w1600", size: 1600 },
  { preset: "w400", size: 400 },
] as const;
export type Preset = (typeof RENDITIONS)[number]["preset"];

export interface PreparedRendition {
  readonly preset: Preset;
  readonly width: number;
  readonly height: number;
  readonly data: Buffer;
}

export interface PreparedImage {
  readonly format: ImageFormat;
  readonly mimeType: string;
  readonly original: Buffer;
  readonly width: number;
  readonly height: number;
  readonly checksum: Buffer;
  readonly filename: string | null;
  readonly renditions: readonly PreparedRendition[];
}

export type ImageRejection = "unsupported_format" | "too_large" | "too_small" | "unreadable";

export type PrepareResult =
  | { readonly ok: true; readonly image: PreparedImage }
  | { readonly ok: false; readonly reason: ImageRejection };

/** Erkennt das Format an den ersten Bytes. */
export function sniffFormat(data: Uint8Array): ImageFormat | undefined {
  const b = data;
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "jpeg";
  if (b.length >= 8 && [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((v, i) => b[i] === v))
    return "png";
  if (
    b.length >= 12 &&
    Buffer.from(b.subarray(0, 4)).toString("latin1") === "RIFF" &&
    Buffer.from(b.subarray(8, 12)).toString("latin1") === "WEBP"
  )
    return "webp";
  return undefined;
}

/** Nur der Dateiname ohne Pfad, höchstens 200 Zeichen, ohne Steuerzeichen. */
function cleanFilename(name: string | undefined): string | null {
  if (name === undefined) return null;
  const base = name.split(/[\\/]/).pop() ?? "";
  const clean = [...base]
    .filter((ch) => {
      const code = ch.codePointAt(0) ?? 0;
      return code >= 0x20 && code !== 0x7f;
    })
    .join("")
    .trim()
    .slice(0, 200);
  return clean.length > 0 ? clean : null;
}

export async function prepareImage(data: Uint8Array, filename?: string): Promise<PrepareResult> {
  if (data.length > MAX_IMAGE_BYTES) return { ok: false, reason: "too_large" };
  const format = sniffFormat(data);
  if (format === undefined) return { ok: false, reason: "unsupported_format" };
  const input = Buffer.from(data.buffer, data.byteOffset, data.byteLength);
  const options = { limitInputPixels: MAX_PIXELS, failOn: "error" as const, animated: false };
  try {
    const meta = await sharp(input, options).metadata();
    // Doppelte Sicherung: sharp muss dasselbe Format sehen wie die ersten Bytes.
    if (meta.format !== format) return { ok: false, reason: "unsupported_format" };
    // Gedrehte Handyfotos: Breite und Höhe nach dem Aufrichten.
    const turned = (meta.orientation ?? 1) >= 5;
    const width = turned ? meta.height : meta.width;
    const height = turned ? meta.width : meta.height;
    if (width === undefined || height === undefined) return { ok: false, reason: "unreadable" };
    if (width < MIN_SIDE || height < MIN_SIDE) return { ok: false, reason: "too_small" };
    const renditions: PreparedRendition[] = [];
    for (const r of RENDITIONS) {
      const out = await sharp(input, options)
        .rotate()
        .resize({ width: r.size, height: r.size, fit: "inside", withoutEnlargement: true })
        .webp({ quality: 82 })
        .toBuffer({ resolveWithObject: true });
      renditions.push({ preset: r.preset, width: out.info.width, height: out.info.height, data: out.data });
    }
    return {
      ok: true,
      image: {
        format,
        mimeType: MIME[format],
        original: input,
        width,
        height,
        checksum: createHash("sha256").update(input).digest(),
        filename: cleanFilename(filename),
        renditions,
      },
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (/pixel limit/i.test(message)) return { ok: false, reason: "too_large" };
    return { ok: false, reason: "unreadable" };
  }
}
