import { describe, expect, it } from "vitest";
import { MAX_VIDEO_BYTES, prepareVideo, sniffVideo } from "./video.js";

const mp4 = (): Buffer =>
  Buffer.concat([Buffer.from([0, 0, 0, 24]), Buffer.from("ftypisom"), Buffer.alloc(12)]);
const webm = (): Buffer => Buffer.concat([Buffer.from([0x1a, 0x45, 0xdf, 0xa3]), Buffer.alloc(20)]);

describe("Video prüfen (P5)", () => {
  it("erkennt MP4 und WebM an den ersten Bytes", () => {
    expect(sniffVideo(mp4())).toBe("mp4");
    expect(sniffVideo(webm())).toBe("webm");
    // Ein als Video getarntes PNG wird nicht erkannt.
    expect(
      sniffVideo(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0])),
    ).toBeUndefined();
  });

  it("nimmt gültige Dateien an und lehnt den Rest ab", () => {
    const gut = prepareVideo(mp4(), "film.mp4");
    expect(gut.ok).toBe(true);
    if (gut.ok) {
      expect(gut.video.mimeType).toBe("video/mp4");
      expect(gut.video.filename).toBe("film.mp4");
      expect(gut.video.checksum).toHaveLength(32);
    }
    expect(prepareVideo(Buffer.alloc(0))).toEqual({ ok: false, reason: "unreadable" });
    expect(prepareVideo(Buffer.from("kein Video, nur Text"))).toEqual({
      ok: false,
      reason: "unsupported_format",
    });
    const zuGross = Buffer.concat([mp4(), Buffer.alloc(MAX_VIDEO_BYTES)]);
    expect(prepareVideo(zuGross)).toEqual({ ok: false, reason: "too_large" });
  });
});
