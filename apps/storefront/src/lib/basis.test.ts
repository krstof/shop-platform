import { describe, expect, it } from "vitest";
import { oeffentlicheBasis } from "./basis.js";

const intern = new URL("http://localhost:4321/teeladen/produkte.xml");

describe("öffentliche Basisadresse", () => {
  it("nimmt die Adresse, die Caddy weitergibt", () => {
    const kopf = new Headers({ "x-forwarded-host": "shop.example.com", "x-forwarded-proto": "https" });
    expect(oeffentlicheBasis(kopf, intern)).toBe("https://shop.example.com");
  });

  it("nimmt bei mehreren Zwischenstationen die erste Angabe", () => {
    const kopf = new Headers({
      "x-forwarded-host": "shop.example.com, intern:4321",
      "x-forwarded-proto": "https, http",
    });
    expect(oeffentlicheBasis(kopf, intern)).toBe("https://shop.example.com");
  });

  it("behält den Port, wenn einer mitkommt", () => {
    const kopf = new Headers({ "x-forwarded-host": "shop.localhost:8443", "x-forwarded-proto": "https" });
    expect(oeffentlicheBasis(kopf, intern)).toBe("https://shop.localhost:8443");
  });

  it("fällt ohne Kopfzeilen auf die interne Adresse zurück", () => {
    expect(oeffentlicheBasis(new Headers(), intern)).toBe("http://localhost:4321");
  });

  it("lässt einen untergeschobenen Hostnamen nicht durch", () => {
    const kopf = new Headers({ "x-forwarded-host": "boese.example.com/pfad?x=1" });
    expect(oeffentlicheBasis(kopf, intern)).toBe("http://localhost:4321");
  });

  it("nimmt bei unbekanntem Schema https an", () => {
    const kopf = new Headers({ "x-forwarded-host": "shop.example.com", "x-forwarded-proto": "javascript" });
    expect(oeffentlicheBasis(kopf, intern)).toBe("https://shop.example.com");
  });
});
