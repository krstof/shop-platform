// Produktfeed im Format von Google Merchant Center (22.11.2026).
//
// Dasselbe Format lesen auch Meta und die meisten Preisvergleiche, und es ist die Grundlage dafür,
// dass ein Shop in der KI-Suche auftaucht. Hier steht nur das Bauen des Feeds, damit es sich ohne
// Server prüfen lässt; die Route darüber holt die Daten.
import type { StoreProduct } from "./store-api.js";

/** Macht Text für XML sicher. */
function x(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

/** Kürzt einen Text auf die Länge, die Google je Feld annimmt, ohne mitten im Wort zu enden. */
function kurz(text: string, max: number): string {
  const sauber = text.replace(/\s+/g, " ").trim();
  if (sauber.length <= max) return sauber;
  const schnitt = sauber.slice(0, max);
  const luecke = schnitt.lastIndexOf(" ");
  return `${luecke > max * 0.6 ? schnitt.slice(0, luecke) : schnitt}…`;
}

function eintrag(produkt: StoreProduct, basis: string): string {
  const preis = produkt.price;
  if (preis === null) return "";
  const bild = produkt.images[0]?.url;
  const zeilen = [
    `<g:id>${x(produkt.id)}</g:id>`,
    `<g:title>${x(kurz(produkt.name, 150))}</g:title>`,
    `<g:description>${x(kurz(produkt.description === "" ? produkt.name : produkt.description, 5000))}</g:description>`,
    `<g:link>${x(`${basis}/produkt/${produkt.slug}`)}</g:link>`,
    `<g:availability>${produkt.inStock ? "in_stock" : "out_of_stock"}</g:availability>`,
    `<g:price>${(preis.amount / 100).toFixed(2)} ${preis.currency}</g:price>`,
    `<g:condition>new</g:condition>`,
  ];
  if (bild !== undefined) zeilen.push(`<g:image_link>${x(bild)}</g:image_link>`);
  for (const weiteres of produkt.images.slice(1, 11))
    zeilen.push(`<g:additional_image_link>${x(weiteres.url)}</g:additional_image_link>`);
  const vorher = produkt.compareAtPrice;
  if (vorher !== undefined && vorher !== null && vorher.amount > preis.amount) {
    zeilen.push(`<g:sale_price>${(preis.amount / 100).toFixed(2)} ${preis.currency}</g:sale_price>`);
    zeilen[zeilen.findIndex((z) => z.startsWith("<g:price>"))] =
      `<g:price>${(vorher.amount / 100).toFixed(2)} ${vorher.currency}</g:price>`;
  }
  return `    <item>\n      ${zeilen.join("\n      ")}\n    </item>`;
}

/** Baut den ganzen Feed. `basis` ist die Adresse des Shops ohne Schrägstrich am Ende. */
export function produktfeedXml(shopName: string, basis: string, produkte: readonly StoreProduct[]): string {
  const items = produkte.map((p) => eintrag(p, basis)).filter((z) => z !== "");
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<rss version="2.0" xmlns:g="http://base.google.com/ns/1.0">',
    "  <channel>",
    `    <title>${x(shopName)}</title>`,
    `    <link>${x(basis)}</link>`,
    `    <description>${x(`Produkte von ${shopName}`)}</description>`,
    ...items,
    "  </channel>",
    "</rss>",
    "",
  ].join("\n");
}
