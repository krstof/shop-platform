import { describe, expect, it } from "vitest";
import { pruefeKontakt } from "./kontakt.js";

describe("Kontaktformular", () => {
  it("nimmt gültige Angaben an und säubert Leerzeichen", () => {
    const r = pruefeKontakt({
      name: "  Kim   Muster ",
      email: " kim@example.org ",
      subject: "",
      message: " Hallo,\r\nzweite Zeile ",
    });
    expect(r.ok).toBe(true);
    expect(r.werte).toEqual({
      name: "Kim Muster",
      email: "kim@example.org",
      subject: "",
      message: "Hallo,\nzweite Zeile",
    });
  });

  it("meldet fehlenden Namen, falsche E-Mail und leere Nachricht", () => {
    const r = pruefeKontakt({ name: " ", email: "kim(at)example", message: "  " });
    expect(r.ok).toBe(false);
    expect(Object.keys(r.fehler).sort()).toEqual(["email", "message", "name"]);
  });

  it("kürzt zu lange Eingaben auf die Grenzen der API", () => {
    const r = pruefeKontakt({ name: "a".repeat(300), email: "a@b.de", message: "x".repeat(6000) });
    expect(r.werte.name).toHaveLength(100);
    expect(r.werte.message).toHaveLength(5000);
  });
});
