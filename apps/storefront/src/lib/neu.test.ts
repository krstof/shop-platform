import { describe, expect, it } from "vitest";
import { istNeu, nurVerfuegbar } from "./neu.js";

describe("Neu-Marke", () => {
  const jetzt = new Date("2026-11-14T12:00:00Z");
  it("bis 14 Tage neu", () => {
    expect(istNeu("2026-11-14T10:00:00Z", jetzt)).toBe(true);
    expect(istNeu("2026-10-31T12:00:00Z", jetzt)).toBe(true);
    expect(istNeu("2026-10-31T11:59:00Z", jetzt)).toBe(false);
  });
  it("ohne oder kaputtes Datum, Zukunft: nicht neu", () => {
    expect(istNeu(null, jetzt)).toBe(false);
    expect(istNeu(undefined, jetzt)).toBe(false);
    expect(istNeu("gestern", jetzt)).toBe(false);
    expect(istNeu("2026-12-01T00:00:00Z", jetzt)).toBe(false);
  });

  it("gehorcht dem Schalter am Produkt (P5)", () => {
    const jetzt = new Date("2026-11-15T10:00:00Z");
    // „immer“ zeigt das Schildchen auch bei einem alten Produkt und ohne Datum.
    expect(istNeu("2020-01-01T00:00:00Z", jetzt, "always")).toBe(true);
    expect(istNeu(null, jetzt, "always")).toBe(true);
    // „nie“ verbietet es auch bei einem frischen Produkt.
    expect(istNeu("2026-11-14T10:00:00Z", jetzt, "never")).toBe(false);
    // „auto“ rechnet wie bisher mit dem Datum.
    expect(istNeu("2026-11-14T10:00:00Z", jetzt, "auto")).toBe(true);
  });
  it("Filter aus der Adresse", () => {
    expect(nurVerfuegbar("ja")).toBe(true);
    expect(nurVerfuegbar("1")).toBe(false);
    expect(nurVerfuegbar(null)).toBe(false);
  });
});
