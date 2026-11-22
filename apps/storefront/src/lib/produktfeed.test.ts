// Der Produktfeed geht an Google, Meta und KI-Einkaufsassistenten. Fehler darin fallen erst
// Wochen später auf, deshalb prüfen wir das Format hier genau.
import { describe, expect, it } from "vitest";
import { produktfeedXml } from "./produktfeed.js";
import type { StoreProduct } from "./store-api.js";

function produkt(teil: Partial<StoreProduct> = {}): StoreProduct {
  return {
    id: "11111111-2222-4333-8444-555555555555",
    name: "Sencha Frühlingshauch",
    slug: "sencha-fruehlingshauch",
    description: "Ein klassischer gedämpfter Grüntee aus Shizuoka.",
    price: { amount: 890, currency: "EUR" },
    taxRatePercent: 7,
    inStock: true,
    maxQuantity: 10,
    categoryId: null,
    images: [
      {
        id: "b1",
        url: "https://media.test/gross.webp",
        thumbnailUrl: "https://media.test/klein.webp",
        width: 1600,
        height: 1200,
      },
    ],
    ...teil,
  };
}

const BASIS = "https://shop.test/teeladen";

describe("produktfeedXml", () => {
  it("baut einen Eintrag mit Pflichtangaben", () => {
    const feed = produktfeedXml("Teeladen", BASIS, [produkt()]);
    expect(feed).toContain("<g:id>11111111-2222-4333-8444-555555555555</g:id>");
    expect(feed).toContain("<g:title>Sencha Frühlingshauch</g:title>");
    expect(feed).toContain("<g:link>https://shop.test/teeladen/produkt/sencha-fruehlingshauch</g:link>");
    expect(feed).toContain("<g:price>8.90 EUR</g:price>");
    expect(feed).toContain("<g:availability>in_stock</g:availability>");
    expect(feed).toContain("<g:image_link>https://media.test/gross.webp</g:image_link>");
    expect(feed).toContain("<g:condition>new</g:condition>");
  });

  it("meldet ausverkaufte Produkte als nicht lieferbar", () => {
    expect(produktfeedXml("Teeladen", BASIS, [produkt({ inStock: false })])).toContain(
      "<g:availability>out_of_stock</g:availability>",
    );
  });

  it("gibt bei einem Angebot den Normalpreis als Preis und den Angebotspreis gesondert an", () => {
    const feed = produktfeedXml("Teeladen", BASIS, [
      produkt({ price: { amount: 690, currency: "EUR" }, compareAtPrice: { amount: 890, currency: "EUR" } }),
    ]);
    expect(feed).toContain("<g:price>8.90 EUR</g:price>");
    expect(feed).toContain("<g:sale_price>6.90 EUR</g:sale_price>");
  });

  it("lässt ein Produkt ohne Preis weg, statt einen leeren Eintrag zu schreiben", () => {
    const feed = produktfeedXml("Teeladen", BASIS, [produkt({ price: null })]);
    expect(feed).not.toContain("<item>");
  });

  it("schützt Sonderzeichen, damit die Datei gültig bleibt", () => {
    const feed = produktfeedXml("Tee & mehr", BASIS, [
      produkt({ name: 'Tee "pur" & <frisch>', description: "a & b" }),
    ]);
    expect(feed).toContain("<title>Tee &amp; mehr</title>");
    expect(feed).toContain("<g:title>Tee &quot;pur&quot; &amp; &lt;frisch&gt;</g:title>");
    // Kein rohes & bleibt übrig: Jedes & gehört zu einer Entität wie &amp; oder &quot;.
    for (const treffer of feed.matchAll(/&(?![a-z]+;)/g)) expect(treffer[0]).toBe("");
  });

  it("kürzt einen zu langen Namen am Wortende", () => {
    const lang = `${"Tee ".repeat(60)}Ende`;
    const feed = produktfeedXml("Teeladen", BASIS, [produkt({ name: lang })]);
    const titel = /<g:title>([^<]*)<\/g:title>/.exec(feed)?.[1] ?? "";
    expect(titel.length).toBeLessThanOrEqual(151);
    expect(titel.endsWith("…")).toBe(true);
    expect(titel).not.toContain("  ");
  });

  it("nimmt den Namen als Beschreibung, wenn es keine gibt", () => {
    expect(produktfeedXml("Teeladen", BASIS, [produkt({ description: "" })])).toContain(
      "<g:description>Sencha Frühlingshauch</g:description>",
    );
  });

  it("gibt weitere Bilder gesondert an, aber höchstens zehn", () => {
    const bilder = Array.from({ length: 14 }, (_, i) => ({
      id: `b${i}`,
      url: `https://media.test/${i}.webp`,
      thumbnailUrl: `https://media.test/${i}-klein.webp`,
      width: 800,
      height: 600,
    }));
    const feed = produktfeedXml("Teeladen", BASIS, [produkt({ images: bilder })]);
    expect(feed.match(/<g:additional_image_link>/g) ?? []).toHaveLength(10);
    expect(feed).toContain("<g:image_link>https://media.test/0.webp</g:image_link>");
  });

  it("ist auch ohne Produkte eine gültige Datei", () => {
    const feed = produktfeedXml("Teeladen", BASIS, []);
    expect(feed.startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(true);
    expect(feed.trimEnd().endsWith("</rss>")).toBe(true);
    expect(feed).not.toContain("<item>");
  });
});
