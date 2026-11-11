import { describe, expect, it } from "vitest";
import { handleFromName } from "./handle.js";
import { groupSecret, qrPath } from "./qr.js";

describe("Kurzname aus dem Shopnamen", () => {
  it("macht Umlaute, Leerzeichen und Sonderzeichen adressfähig", () => {
    expect(handleFromName("Bäckerei Müller & Söhne")).toBe("baeckerei-mueller-soehne");
    expect(handleFromName("  Café  Größe!! ")).toBe("cafe-groesse");
    expect(handleFromName("Teeladen")).toBe("teeladen");
  });
  it("hält die Grenze von 63 Zeichen ein und endet nicht mit Bindestrich", () => {
    const h = handleFromName(`${"a".repeat(62)} b`);
    expect(h.length).toBeLessThanOrEqual(63);
    expect(h.endsWith("-")).toBe(false);
  });
});

describe("QR-Code für die Authenticator-App", () => {
  it("liefert einen Pfad mit Ruhezone", () => {
    const qr = qrPath("otpauth://totp/Shop:betreiber%40plattform.example?secret=JBSWY3DPEHPK3PXP");
    expect(qr.size).toBeGreaterThanOrEqual(21 + 8);
    expect(qr.path).toMatch(/^M\d+ \d+h1v1h-1z/);
    // Oben links beginnt das Suchmuster genau nach der Ruhezone.
    expect(qr.path.startsWith("M4 4h1v1h-1z")).toBe(true);
  });
  it("gruppiert das Geheimnis zum Abtippen", () => {
    expect(groupSecret("JBSWY3DPEHPK3PXP")).toBe("JBSW Y3DP EHPK 3PXP");
  });
});
