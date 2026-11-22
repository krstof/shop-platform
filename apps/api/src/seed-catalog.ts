// Testprodukte (MVP-Etappe M2) für die Testshops: dieselben Teesorten wie in der Vorschau der
// Storefront (apps/storefront/src/vorschau/daten.ts), dazu ein paar Stücke für den Modeladen.
// Angelegt über die echte Admin-API (dieselben Prüfungen wie für Händler), nicht an ihr vorbei.
// Bilder (21.11.2026): echte Fotos aus `apps/api/seed-images` statt der früher gezeichneten
// Platzhalter, je Produkt und je Kategorie eines. Herkunft und Lizenz stehen in
// `apps/api/seed-images/BILDQUELLEN.md`; alle sind CC0 oder gemeinfrei.
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import type { Endpoint } from "@shop/http";
import { createLogger, type Database } from "@shop/kernel";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { createApi } from "./app.js";
import { databaseIdempotencyStore } from "./idempotency-store.js";

interface SeedCategory {
  readonly slug: string;
  readonly name: string;
  readonly description: string;
  /** Dateiname ohne Endung in `apps/api/seed-images`. */
  readonly image: string;
}

interface SeedProduct {
  readonly name: string;
  readonly category: string;
  readonly description: string;
  /** Bruttopreis in Cent. */
  readonly price: number;
  readonly taxClass: "standard" | "reduced";
  readonly stock: number;
  /** Dateiname ohne Endung in `apps/api/seed-images`. */
  readonly image: string;
}

interface SeedWebFont {
  readonly id: string;
  readonly name: string;
  readonly category: "serif" | "sans-serif" | "display" | "handwriting" | "monospace";
}

interface SeedCatalog {
  readonly categories: readonly SeedCategory[];
  readonly products: readonly SeedProduct[];
  /** Aussehen des Testshops: Logo, Bühne, Farben, Texte. */
  readonly design: SeedDesign;
}

interface SeedDesign {
  /** Dateiname des Logos ohne Endung (PNG mit Transparenz). */
  readonly logo: string;
  /** Dateiname des Bühnenbilds ohne Endung. */
  readonly hero: string;
  readonly accentColor: string;
  /** Grundschrift des Shops, falls keine eigene gewählt wird. */
  readonly font: "klassisch" | "modern" | "freundlich";
  /** Schrift der Überschriften bzw. des Fließtexts (Google Fonts, wie im Editor). */
  readonly headingFont: SeedWebFont;
  readonly bodyFont: SeedWebFont;
  readonly template: "klassisch" | "modern" | "galerie" | "editorial";
  readonly heroTitle: string;
  readonly heroText: string;
  /** Beschriftung und Ziel des Knopfs in der Bühne. */
  readonly heroButton: { readonly label: string; readonly url: string };
  /** Zuschnitt-Punkt des Bühnenbilds in Prozent (Computer und Handy getrennt). */
  readonly heroFocus: {
    readonly x: number;
    readonly y: number;
    readonly mobileX: number;
    readonly mobileY: number;
  };
  readonly tagline: string;
  readonly footerText: string;
  /** Namen der Produkte, die als Empfehlungen oben stehen. */
  readonly featured: readonly string[];
}

export const SEED_CATALOG: Readonly<Record<string, SeedCatalog>> = {
  teeladen: {
    categories: [
      {
        slug: "gruentee",
        name: "Grüntee",
        description: "Frisch, grasig, manchmal leicht süß. Am besten mit 70 bis 80 °C heißem Wasser.",
        image: "tee-kat-gruentee",
      },
      {
        slug: "schwarztee",
        name: "Schwarztee",
        description: "Kräftig und malzig, pur oder mit einem Schuss Milch.",
        image: "tee-kat-schwarztee",
      },
      {
        slug: "kraeutertee",
        name: "Kräutertee",
        description: "Ohne Koffein, für jede Tageszeit.",
        image: "tee-kat-kraeutertee",
      },
    ],
    products: [
      {
        name: "Sencha Frühlingshauch",
        category: "gruentee",
        description:
          "Ein klassischer gedämpfter Grüntee aus Shizuoka. Leuchtend grüne Tasse, frischer Duft nach Gras und ein sanfter, leicht süßer Abgang.\n\nZubereitung: 3 g auf 250 ml, 75 °C, 1 bis 2 Minuten.",
        price: 890,
        taxClass: "reduced",
        stock: 30,
        image: "tee-sencha",
      },
      {
        name: "Jasmin-Perlen",
        category: "gruentee",
        description:
          "Junge Blätter werden zu kleinen Perlen gerollt und mehrere Nächte mit frischen Jasminblüten beduftet. Blumig, weich und mehrfach aufgießbar.\n\nZubereitung: 4 g auf 250 ml, 80 °C, 2 Minuten.",
        price: 1450,
        taxClass: "reduced",
        stock: 12,
        image: "tee-jasmin",
      },
      {
        name: "Assam Morgenstund",
        category: "schwarztee",
        description:
          "Ein vollmundiger Assam mit goldenen Spitzen. Malzig und kräftig, passt gut zu Milch und weckt zuverlässig auf.\n\nZubereitung: 3 g auf 250 ml, 95 °C, 3 bis 4 Minuten.",
        price: 690,
        taxClass: "reduced",
        stock: 40,
        image: "tee-assam",
      },
      {
        name: "Earl Grey Classic",
        category: "schwarztee",
        description:
          "Ceylon-Schwarztee mit dem Öl der Bergamotte-Frucht. Zitrusfrisch und elegant, ein Klassiker am Nachmittag.\n\nZubereitung: 3 g auf 250 ml, 95 °C, 3 Minuten.",
        price: 1190,
        taxClass: "reduced",
        stock: 18,
        image: "tee-earlgrey",
      },
      {
        name: "Pfefferminze pur",
        category: "kraeutertee",
        description:
          "Große, ganze Blätter der Pfefferminze aus deutschem Anbau. Kühl, klar und ohne Zusätze, heiß oder kalt ein Genuss.\n\nZubereitung: 2 g auf 250 ml, 100 °C, 5 bis 8 Minuten.",
        price: 550,
        taxClass: "reduced",
        stock: 50,
        image: "tee-pfefferminze",
      },
      {
        name: "Rooibos Vanille",
        category: "kraeutertee",
        description:
          "Rooibos aus den Zederbergen mit Stückchen echter Bourbon-Vanille. Rund, weich und von Natur aus süßlich.\n\nZubereitung: 3 g auf 250 ml, 100 °C, 6 Minuten.",
        price: 790,
        taxClass: "reduced",
        stock: 0,
        image: "tee-rooibos",
      },
    ],
    design: {
      logo: "tee-logo",
      hero: "tee-buehne",
      accentColor: "#43684a",
      font: "klassisch",
      headingFont: { id: "lora", name: "Lora", category: "serif" },
      bodyFont: { id: "inter", name: "Inter", category: "sans-serif" },
      template: "klassisch",
      heroTitle: "Tee aus kleinen Gärten, frisch aufgelegt",
      heroText:
        "Wir kaufen in kleinen Mengen direkt bei den Gärten ein und füllen jede Sorte von Hand ab. " +
        "So kommt der Tee frisch bei dir an.",
      heroButton: { label: "Tees ansehen", url: "/" },
      // Das Teefeld liegt im unteren Drittel des Fotos, am Handy noch etwas weiter unten.
      heroFocus: { x: 50, y: 75, mobileX: 50, mobileY: 100 },
      tagline: "Lose Tees seit 1998",
      footerText: "Wir sind montags bis freitags von 9 bis 18 Uhr für dich da.",
      featured: ["Sencha Frühlingshauch", "Earl Grey Classic", "Rooibos Vanille"],
    },
  },
  modeladen: {
    categories: [
      {
        slug: "oberteile",
        name: "Oberteile",
        description: "T-Shirts, Hemden und Pullover.",
        image: "mode-kat-oberteile",
      },
      {
        slug: "accessoires",
        name: "Accessoires",
        description: "Mützen, Schals und Taschen.",
        image: "mode-kat-accessoires",
      },
    ],
    products: [
      {
        name: "T-Shirt Basic",
        category: "oberteile",
        description: "Weiches T-Shirt aus Bio-Baumwolle, gerade geschnitten.",
        price: 1990,
        taxClass: "standard",
        stock: 60,
        image: "mode-tshirt",
      },
      {
        name: "Leinenhemd Sommer",
        category: "oberteile",
        description: "Luftiges Hemd aus reinem Leinen für warme Tage.",
        price: 4990,
        taxClass: "standard",
        stock: 15,
        image: "mode-leinenhemd",
      },
      {
        name: "Wollmütze Fjord",
        category: "accessoires",
        description: "Warme Mütze aus Merinowolle, eine Größe für alle.",
        price: 2490,
        taxClass: "standard",
        stock: 25,
        image: "mode-muetze",
      },
    ],
    design: {
      logo: "mode-logo",
      hero: "mode-buehne",
      accentColor: "#2f3b57",
      font: "modern",
      headingFont: { id: "inter", name: "Inter", category: "sans-serif" },
      bodyFont: { id: "inter", name: "Inter", category: "sans-serif" },
      template: "modern",
      heroTitle: "Kleidung, die lange hält",
      heroText:
        "Wenige Teile, gute Stoffe, ruhige Farben. Alles so geschnitten, dass es nach dem zehnten " +
        "Waschen noch sitzt.",
      heroButton: { label: "Zur Kollektion", url: "/" },
      heroFocus: { x: 50, y: 25, mobileX: 50, mobileY: 25 },
      tagline: "Schlichte Mode aus guten Stoffen",
      footerText: "Versand innerhalb Deutschlands, Rückgabe innerhalb von 30 Tagen.",
      featured: ["Leinenhemd Sommer", "Wollmütze Fjord"],
    },
  },
};

/** Ordner mit den Fotos der Testdaten, neben `dist` im Paket @shop/api. */
const SEED_IMAGES = fileURLToPath(new URL("../seed-images/", import.meta.url));

/** Liest ein Foto der Testdaten. `logo` ist PNG mit Transparenz, alles andere JPEG. */
export async function seedImage(name: string): Promise<{ data: string; filename: string }> {
  const extension = name.endsWith("-logo") ? "png" : "jpg";
  const file = `${name}.${extension}`;
  return { data: (await readFile(SEED_IMAGES + file)).toString("base64"), filename: file };
}

/**
 * Legt Kategorien und Produkte eines Testshops an, wenn der Shop noch keine Produkte hat, und
 * ergänzt alles, was später dazugekommen ist: Produktfotos, Kategoriebilder und das Aussehen
 * (Logo, Bühnenbild, Farben, Schriften, Texte). Jeder Schritt darf mehrfach laufen.
 */
export async function seedCatalog(options: {
  readonly database: Database<unknown>;
  readonly endpoints: readonly Endpoint[];
  readonly tenantId: string;
  readonly handle: string;
}): Promise<string> {
  const catalog = SEED_CATALOG[options.handle];
  if (catalog === undefined) return "keine Testprodukte vorgesehen";
  const app: NestFastifyApplication = await createApi({
    endpoints: options.endpoints,
    // Der Befehl handelt als System für genau diesen einen Shop, mit Katalog- und Einstellungsrechten.
    resolveActor: async () => ({
      actor: { type: "system" },
      tenantId: options.tenantId,
      scopes: new Set(["products:read", "products:write", "settings:read", "settings:write"]),
    }),
    logger: createLogger({ level: "silent" }),
    idempotency: databaseIdempotencyStore(options.database),
  });
  const http = app.getHttpAdapter().getInstance();
  const call = async (method: HttpMethod, url: string, payload?: object, headers?: HeaderMap) => {
    const r = await http.inject({
      method,
      url,
      ...(payload === undefined ? {} : { payload }),
      ...(headers === undefined ? {} : { headers }),
    });
    if (r.statusCode >= 300) throw new Error(`${method} ${url}: ${r.statusCode} ${r.body}`);
    return r.json() as SeedResponse;
  };
  try {
    const existing = await call("GET", "/admin/v1/products?limit=100");
    const parts: string[] = [];
    if ((existing.data ?? []).length === 0) {
      const categoryIds = new Map<string, string>();
      for (const c of catalog.categories) {
        const body = { slug: c.slug, name: c.name, description: c.description };
        categoryIds.set(c.slug, (await call("POST", "/admin/v1/categories", body)).id);
      }
      for (const p of catalog.products) {
        await call("POST", "/admin/v1/products", {
          name: p.name,
          description: p.description,
          price: { amount: p.price, currency: "EUR" },
          taxClass: p.taxClass,
          stock: p.stock,
          categoryId: categoryIds.get(p.category),
          status: "published",
        });
      }
      parts.push(`${catalog.categories.length} Kategorien und ${catalog.products.length} Produkte angelegt`);
    } else {
      parts.push("Produkte gibt es schon, bleiben unverändert");
    }

    // Produktfotos: fehlende nachtragen und die früher gezeichneten Platzhalter ersetzen. Die
    // Platzhalter waren immer quadratisch (1200 × 1200), die Fotos sind es nie.
    const products = (await call("GET", "/admin/v1/products?limit=100")).data as SeedProductRow[];
    let pictures = 0;
    for (const p of catalog.products) {
      const product = products.find((x) => x.name === p.name);
      if (product === undefined) continue;
      const placeholder =
        product.images.length === 1 && product.images[0]?.width === product.images[0]?.height;
      if (product.images.length > 0 && !placeholder) continue;
      for (const image of product.images)
        await call("DELETE", `/admin/v1/products/${product.id}/images/${image.id}`);
      await call("POST", `/admin/v1/products/${product.id}/images`, await seedImage(p.image));
      pictures++;
    }
    if (pictures > 0) parts.push(`${pictures} Produktfotos hochgeladen`);

    // Kategoriebilder: nur für Kategorien, die noch keines haben.
    const categories = (await call("GET", "/admin/v1/categories?limit=100")).data as SeedCategoryRow[];
    let categoryImages = 0;
    for (const c of catalog.categories) {
      const category = categories.find((x) => x.slug === c.slug);
      if (category === undefined || (category.image !== null && category.image !== undefined)) continue;
      await call("PUT", `/admin/v1/categories/${category.id}/image`, await seedImage(c.image));
      categoryImages++;
    }
    if (categoryImages > 0) parts.push(`${categoryImages} Kategoriebilder hochgeladen`);

    if (await seedDesign(call, catalog, products)) parts.push("Aussehen eingerichtet");
    return parts.join(", ");
  } finally {
    await app.close();
  }
}

/**
 * Richtet das Aussehen eines Testshops ein: Logo, Bühnenbild mit Überschrift, Hauptfarbe, Schriften,
 * Slogan, Fußzeile und hervorgehobene Produkte. Läuft nur, solange der Shop noch kein Logo hat, damit
 * eigene Änderungen im Editor nicht überschrieben werden.
 */
async function seedDesign(
  call: (method: HttpMethod, url: string, payload?: object, headers?: HeaderMap) => Promise<SeedResponse>,
  catalog: SeedCatalog,
  products: readonly SeedProductRow[],
): Promise<boolean> {
  const before = (await call("GET", "/admin/v1/design")) as unknown as DesignState;
  if (before.draft.logo !== null || before.published.logo !== null) return false;
  const design = catalog.design;
  await call("POST", "/admin/v1/design/logo", await seedImage(design.logo));
  const hero = await call("POST", "/admin/v1/design/images", await seedImage(design.hero));
  const current = (await call("GET", "/admin/v1/design")) as unknown as DesignState;
  const featured = design.featured
    .map((name) => products.find((p) => p.name === name)?.id)
    .filter((id): id is string => id !== undefined);
  await call(
    "PUT",
    "/admin/v1/design/draft",
    {
      accentColor: design.accentColor,
      font: design.font,
      logoImageId: current.draft.logo?.id ?? null,
      headingFont: design.headingFont,
      bodyFont: design.bodyFont,
      template: design.template,
      tagline: design.tagline,
      home: {
        heroImageId: hero.id,
        heroTitle: design.heroTitle,
        heroText: design.heroText,
        featuredProductIds: featured,
        showCategories: true,
        showNew: true,
        // Dieselbe Reihenfolge wie ohne Bausteine, aber mit Inhalt: nur so bekommt die Bühne
        // Zuschnitt-Punkt und Knopf (22.11.2026).
        blocks: [
          { id: "buehne", type: "hero" },
          { id: "empfohlen", type: "featured" },
          { id: "neu", type: "new" },
          { id: "kategorien", type: "categories" },
        ],
        sections: {
          buehne: {
            focusX: design.heroFocus.x,
            focusY: design.heroFocus.y,
            focusMobileX: design.heroFocus.mobileX,
            focusMobileY: design.heroFocus.mobileY,
            buttonLabel: design.heroButton.label,
            buttonUrl: design.heroButton.url,
          },
        },
      },
      footer: { text: design.footerText, links: [] },
    },
    { "if-match": `"${current.version}"` },
  );
  await call("POST", "/admin/v1/design/publish");
  return true;
}

type HttpMethod = "GET" | "POST" | "PUT" | "DELETE";
type HeaderMap = Record<string, string>;

interface SeedResponse {
  readonly id: string;
  readonly data?: readonly unknown[];
}

interface SeedProductRow {
  readonly id: string;
  readonly name: string;
  readonly slug: string;
  readonly images: readonly { readonly id: string; readonly width: number; readonly height: number }[];
}

interface SeedCategoryRow {
  readonly id: string;
  readonly slug: string;
  readonly image: unknown;
}

interface DesignState {
  readonly draft: { readonly logo: { readonly id: string } | null };
  readonly published: { readonly logo: { readonly id: string } | null };
  readonly version: number;
}
