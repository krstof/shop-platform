// Prüft die fertig gebauten Seiten der Vorschau: Links, Pflichtangaben zum Preis, keine fremden
// Quellen und kein eingebettetes Skript (damit die strenge Content-Security-Policy des Testservers passt).
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { build } from "astro";
import { PRODUKTE, KATEGORIEN } from "./vorschau/daten.js";
import { grundpreisText, preisText } from "./vorschau/preis.js";

const root = fileURLToPath(new URL("..", import.meta.url));
let out = "";
const seiten = new Map<string, string>();

async function dateien(dir: string): Promise<string[]> {
  const eintraege = await readdir(dir, { withFileTypes: true, recursive: true });
  return eintraege.filter((e) => e.isFile()).map((e) => join(e.parentPath, e.name));
}

/** Adresse einer Datei, wie der Webserver sie ausliefert. */
function adresse(datei: string): string {
  const rel = "/" + relative(out, datei).split("\\").join("/");
  return rel.endsWith("/index.html") ? rel.slice(0, -"index.html".length) : rel;
}

const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");

beforeAll(async () => {
  process.env["ASTRO_TELEMETRY_DISABLED"] = "1";
  out = await mkdtemp(join(tmpdir(), "storefront-"));
  await build({ root, outDir: out, logLevel: "error" });
  for (const datei of await dateien(out)) {
    if (datei.endsWith(".html")) seiten.set(adresse(datei), await readFile(datei, "utf8"));
  }
});

afterAll(async () => {
  if (out !== "") await rm(out, { recursive: true, force: true });
});

describe("Vorschau der Storefront", () => {
  it("baut Startseite, alle Kategorien, alle Produkte, Rechtliches und 404", () => {
    const erwartet = [
      "/",
      "/rechtliches/",
      "/404.html",
      ...KATEGORIEN.map((k) => `/kategorie/${k.slug}/`),
      ...PRODUKTE.map((p) => `/produkt/${p.slug}/`),
    ];
    expect([...seiten.keys()].sort()).toEqual(erwartet.sort());
  });

  it("jeder interne Link führt zu einer vorhandenen Seite oder Datei", async () => {
    const vorhanden = new Set((await dateien(out)).map(adresse));
    for (const [seite, html] of seiten) {
      for (const [, ziel] of html.matchAll(/(?:href|src)="([^"]+)"/g)) {
        if (ziel === undefined) continue;
        if (ziel.startsWith("#")) {
          expect(html, `${seite}: Sprungziel ${ziel}`).toContain(`id="${ziel.slice(1)}"`);
          continue;
        }
        expect(ziel, `${seite}: nur eigene Adressen`).toMatch(/^\//);
        const pfad = ziel.split("#")[0] ?? "";
        expect(vorhanden.has(pfad), `${seite} verlinkt ${ziel}`).toBe(true);
      }
    }
  });

  it("enthält kein Skript, kein eingebettetes CSS und keine fremden Quellen", () => {
    for (const [seite, html] of seiten) {
      expect(html, seite).not.toMatch(/<script/i);
      expect(html, seite).not.toMatch(/<style/i);
      expect(html, seite).not.toMatch(/\sstyle="/i);
      expect(html, seite).not.toMatch(/\son[a-z]+="/i);
      expect(html, seite).not.toMatch(/(?:href|src)="(?:https?:)?\/\//i);
    }
  });

  it("jede Seite hat Sprache, genau eine Hauptüberschrift, Sprunglink und noindex", () => {
    for (const [seite, html] of seiten) {
      expect(html, seite).toContain('<html lang="de">');
      expect(html.match(/<h1[\s>]/g)?.length, seite).toBe(1);
      expect(html, seite).toContain('href="#inhalt"');
      expect(html, seite).toContain('id="inhalt"');
      expect(html, seite).toContain('<meta name="robots" content="noindex, nofollow">');
      expect(html, seite).toContain("Vorschau mit erfundenen Beispieldaten");
    }
  });

  it("jede Produktseite nennt Preis, Grundpreis, MwSt. und Versand (PAngV)", () => {
    for (const p of PRODUKTE) {
      const t = text(seiten.get(`/produkt/${p.slug}/`) ?? "");
      expect(t).toContain(text(preisText(p.preis)));
      expect(t).toContain(text(grundpreisText(p.preis, p.gramm)));
      expect(t).toContain("inkl. 7 % MwSt., zzgl. Versand");
      expect(t).toContain("In der Vorschau kann noch nicht gekauft werden.");
    }
  });

  it("Kategorieseiten zeigen genau ihre Produkte", () => {
    for (const k of KATEGORIEN) {
      const html = seiten.get(`/kategorie/${k.slug}/`) ?? "";
      for (const p of PRODUKTE) {
        const verlinkt = html.includes(`href="/produkt/${p.slug}/"`);
        expect(verlinkt, `${k.slug} ↔ ${p.slug}`).toBe(p.kategorie === k.slug);
      }
    }
  });
});
