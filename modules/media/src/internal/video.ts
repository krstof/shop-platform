// Video prüfen (Paket P5, Kristof 23.11.2026). Erlaubt sind MP4 und WebM, erkannt an den ersten
// Bytes, nicht am Dateinamen. Umgerechnet wird nichts: Der Shop liefert die Datei so aus, wie sie
// hochgeladen wurde. Das reicht, weil jeder Browser MP4 (H.264) und WebM abspielen kann, und es
// hält den Server klein — Videos umrechnen würde ffmpeg und viel Rechenzeit brauchen.
import { createHash } from "node:crypto";

/**
 * Höchstgröße einer hochgeladenen Videodatei im Speicher (25 MB). Die Admin-API lässt weniger
 * durch (10 MB), weil eine Anfrage insgesamt höchstens 16 MB groß sein darf und Base64 die Datei
 * um ein Drittel aufbläht.
 */
export const MAX_VIDEO_BYTES = 25 * 1024 * 1024;

export type VideoFormat = "mp4" | "webm";

const MIME: Record<VideoFormat, string> = { mp4: "video/mp4", webm: "video/webm" };

export type VideoRejection = "unsupported_format" | "too_large" | "unreadable";

export interface PreparedVideo {
  readonly format: VideoFormat;
  readonly mimeType: string;
  readonly data: Buffer;
  readonly checksum: Buffer;
  readonly filename: string | null;
}

export type PrepareVideoResult =
  | { readonly ok: true; readonly video: PreparedVideo }
  | { readonly ok: false; readonly reason: VideoRejection };

/**
 * Erkennt das Format an den ersten Bytes. MP4 hat ab Byte 4 die Kennung „ftyp“, WebM beginnt mit
 * der EBML-Kennung 1A 45 DF A3 (dasselbe wie Matroska).
 */
export function sniffVideo(data: Uint8Array): VideoFormat | undefined {
  const b = data;
  if (b.length >= 12 && Buffer.from(b.subarray(4, 8)).toString("latin1") === "ftyp") return "mp4";
  if (b.length >= 4 && b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3) return "webm";
  return undefined;
}

export function prepareVideo(data: Uint8Array, filename?: string): PrepareVideoResult {
  if (data.length === 0) return { ok: false, reason: "unreadable" };
  if (data.length > MAX_VIDEO_BYTES) return { ok: false, reason: "too_large" };
  const format = sniffVideo(data);
  if (format === undefined) return { ok: false, reason: "unsupported_format" };
  const buffer = Buffer.from(data);
  return {
    ok: true,
    video: {
      format,
      mimeType: MIME[format],
      data: buffer,
      checksum: createHash("sha256").update(buffer).digest(),
      filename: filename === undefined || filename.trim() === "" ? null : filename.trim().slice(0, 200),
    },
  };
}
