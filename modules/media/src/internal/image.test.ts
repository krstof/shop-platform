import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { MAX_IMAGE_BYTES, prepareImage, sniffFormat } from "./image.js";

const photo = (format: "jpeg" | "png" | "webp", width = 2400, height = 1200) =>
  sharp({ create: { width, height, channels: 3, background: "#7a9a5b" } })
    .toFormat(format)
    .toBuffer();

describe("Bilder prüfen und umrechnen (M2 Teil 2)", () => {
  it.each(["jpeg", "png", "webp"] as const)("nimmt %s an und rechnet zwei WebP-Fassungen", async (format) => {
    const r = await prepareImage(await photo(format), "C:\\Bilder\\tee.jpg");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.image.format).toBe(format);
    expect(r.image.filename).toBe("tee.jpg");
    expect([r.image.width, r.image.height]).toEqual([2400, 1200]);
    expect(r.image.renditions.map((x) => [x.preset, x.width, x.height])).toEqual([
      ["w1600", 1600, 800],
      ["w400", 400, 200],
    ]);
    for (const x of r.image.renditions) expect((await sharp(x.data).metadata()).format).toBe("webp");
  });

  it("vergrößert kleine Bilder nicht", async () => {
    const r = await prepareImage(await photo("png", 300, 200));
    expect(r.ok && r.image.renditions.map((x) => [x.width, x.height])).toEqual([
      [300, 200],
      [300, 200],
    ]);
  });

  it("entfernt Zusatzdaten (EXIF mit Ort) und richtet gedrehte Fotos auf", async () => {
    const withExif = await sharp({ create: { width: 600, height: 300, channels: 3, background: "#fff" } })
      .jpeg()
      .withMetadata({ orientation: 6, exif: { IFD0: { Copyright: "Geheim GPS 52.52 13.40" } } })
      .toBuffer();
    expect((await sharp(withExif).metadata()).exif).toBeDefined();
    const r = await prepareImage(withExif);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect([r.image.width, r.image.height]).toEqual([300, 600]);
    for (const x of r.image.renditions) {
      const meta = await sharp(x.data).metadata();
      expect(meta.exif).toBeUndefined();
      expect(meta.height).toBeGreaterThan(meta.width ?? 0);
      expect(x.data.includes(Buffer.from("Geheim"))).toBe(false);
    }
  });

  it("lehnt SVG, GIF und Text ab, auch mit falschem Dateinamen", async () => {
    const svg = Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><script>alert(1)</script></svg>',
    );
    const gif = await sharp({ create: { width: 64, height: 64, channels: 3, background: "#000" } })
      .gif()
      .toBuffer();
    for (const data of [svg, gif, Buffer.from("hallo welt")])
      expect(await prepareImage(data, "bild.png")).toEqual({ ok: false, reason: "unsupported_format" });
  });

  it("lehnt kaputte, zu kleine und zu große Bilder ab", async () => {
    const png = await photo("png", 200, 200);
    expect(await prepareImage(png.subarray(0, 60))).toEqual({ ok: false, reason: "unreadable" });
    expect(await prepareImage(await photo("png", 20, 200))).toEqual({ ok: false, reason: "too_small" });
    expect(await prepareImage(Buffer.alloc(MAX_IMAGE_BYTES + 1, 0xff))).toEqual({
      ok: false,
      reason: "too_large",
    });
  });

  // Das Testbild (48 Megapixel) zu erzeugen dauert auf den CI-Rechnern mehrere Sekunden.
  it("lehnt Pixelbomben ab (kleine Datei, riesiges Bild)", { timeout: 30_000 }, async () => {
    const bomb = await sharp({ create: { width: 8000, height: 6000, channels: 3, background: "#000" } })
      .png({ compressionLevel: 9 })
      .toBuffer();
    expect(bomb.length).toBeLessThan(MAX_IMAGE_BYTES);
    expect(await prepareImage(bomb)).toEqual({ ok: false, reason: "too_large" });
  });

  it("erkennt das Format an den ersten Bytes", () => {
    expect(sniffFormat(Buffer.from([0xff, 0xd8, 0xff, 0xe0]))).toBe("jpeg");
    expect(sniffFormat(Buffer.from("RIFF0000WEBPVP8 "))).toBe("webp");
    expect(sniffFormat(Buffer.from("RIFF0000WAVE"))).toBeUndefined();
    expect(sniffFormat(Buffer.from("<svg"))).toBeUndefined();
  });
});
