// Testprodukte (MVP-Etappe M2) für die Testshops: dieselben Teesorten wie in der Vorschau der
// Storefront (apps/storefront/src/vorschau/daten.ts), dazu ein paar Stücke für den Modeladen.
// Angelegt über die echte Admin-API (dieselben Prüfungen wie für Händler), nicht an ihr vorbei.
// Dazu je Produkt ein selbst gezeichnetes Bild (M2 Teil 2): Teedose wie in der Vorschau, für den
// Modeladen einfache Umrisse. Ohne Schrift, damit im Container keine Schriftarten nötig sind.
import type { Endpoint } from "@shop/http";
import { createLogger, type Database } from "@shop/kernel";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import sharp from "sharp";
import { createApi } from "./app.js";
import { databaseIdempotencyStore } from "./idempotency-store.js";

interface SeedCategory {
  readonly slug: string;
  readonly name: string;
  readonly description: string;
}

interface SeedProduct {
  readonly name: string;
  readonly category: string;
  readonly description: string;
  /** Bruttopreis in Cent. */
  readonly price: number;
  readonly taxClass: "standard" | "reduced";
  readonly stock: number;
  /** Testbild: Form und Farbe. */
  readonly picture: { readonly shape: Shape; readonly color: string };
}

type Shape = "tin" | "shirt" | "beanie";

interface SeedCatalog {
  readonly categories: readonly SeedCategory[];
  readonly products: readonly SeedProduct[];
}

export const SEED_CATALOG: Readonly<Record<string, SeedCatalog>> = {
  teeladen: {
    categories: [
      {
        slug: "gruentee",
        name: "Grüntee",
        description: "Frisch, grasig, manchmal leicht süß. Am besten mit 70 bis 80 °C heißem Wasser.",
      },
      {
        slug: "schwarztee",
        name: "Schwarztee",
        description: "Kräftig und malzig, pur oder mit einem Schuss Milch.",
      },
      { slug: "kraeutertee", name: "Kräutertee", description: "Ohne Koffein, für jede Tageszeit." },
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
        picture: { shape: "tin", color: "#7a9a5b" },
      },
      {
        name: "Jasmin-Perlen",
        category: "gruentee",
        description:
          "Junge Blätter werden zu kleinen Perlen gerollt und mehrere Nächte mit frischen Jasminblüten beduftet. Blumig, weich und mehrfach aufgießbar.\n\nZubereitung: 4 g auf 250 ml, 80 °C, 2 Minuten.",
        price: 1450,
        taxClass: "reduced",
        stock: 12,
        picture: { shape: "tin", color: "#c9b46a" },
      },
      {
        name: "Assam Morgenstund",
        category: "schwarztee",
        description:
          "Ein vollmundiger Assam mit goldenen Spitzen. Malzig und kräftig, passt gut zu Milch und weckt zuverlässig auf.\n\nZubereitung: 3 g auf 250 ml, 95 °C, 3 bis 4 Minuten.",
        price: 690,
        taxClass: "reduced",
        stock: 40,
        picture: { shape: "tin", color: "#8a4b2f" },
      },
      {
        name: "Earl Grey Classic",
        category: "schwarztee",
        description:
          "Ceylon-Schwarztee mit dem Öl der Bergamotte-Frucht. Zitrusfrisch und elegant, ein Klassiker am Nachmittag.\n\nZubereitung: 3 g auf 250 ml, 95 °C, 3 Minuten.",
        price: 1190,
        taxClass: "reduced",
        stock: 18,
        picture: { shape: "tin", color: "#3f5872" },
      },
      {
        name: "Pfefferminze pur",
        category: "kraeutertee",
        description:
          "Große, ganze Blätter der Pfefferminze aus deutschem Anbau. Kühl, klar und ohne Zusätze, heiß oder kalt ein Genuss.\n\nZubereitung: 2 g auf 250 ml, 100 °C, 5 bis 8 Minuten.",
        price: 550,
        taxClass: "reduced",
        stock: 50,
        picture: { shape: "tin", color: "#4f8a7a" },
      },
      {
        name: "Rooibos Vanille",
        category: "kraeutertee",
        description:
          "Rooibos aus den Zederbergen mit Stückchen echter Bourbon-Vanille. Rund, weich und von Natur aus süßlich.\n\nZubereitung: 3 g auf 250 ml, 100 °C, 6 Minuten.",
        price: 790,
        taxClass: "reduced",
        stock: 0,
        picture: { shape: "tin", color: "#b0603d" },
      },
    ],
  },
  modeladen: {
    categories: [
      { slug: "oberteile", name: "Oberteile", description: "T-Shirts, Hemden und Pullover." },
      { slug: "accessoires", name: "Accessoires", description: "Mützen, Schals und Taschen." },
    ],
    products: [
      {
        name: "T-Shirt Basic",
        category: "oberteile",
        description: "Weiches T-Shirt aus Bio-Baumwolle, gerade geschnitten.",
        price: 1990,
        taxClass: "standard",
        stock: 60,
        picture: { shape: "shirt", color: "#3f5872" },
      },
      {
        name: "Leinenhemd Sommer",
        category: "oberteile",
        description: "Luftiges Hemd aus reinem Leinen für warme Tage.",
        price: 4990,
        taxClass: "standard",
        stock: 15,
        picture: { shape: "shirt", color: "#d8cfb8" },
      },
      {
        name: "Wollmütze Fjord",
        category: "accessoires",
        description: "Warme Mütze aus Merinowolle, eine Größe für alle.",
        price: 2490,
        taxClass: "standard",
        stock: 25,
        picture: { shape: "beanie", color: "#8a4b2f" },
      },
    ],
  },
};

/** Zeichnet ein Testbild (1200 × 1200, PNG). */
export async function seedPicture(picture: SeedProduct["picture"]): Promise<Buffer> {
  const c = picture.color;
  const shapes: Record<Shape, string> = {
    // Teedose wie apps/storefront/src/components/Teedose.astro, Etikett ohne Schrift.
    tin: `<ellipse cx="100" cy="172" rx="52" ry="8" fill="#000" opacity="0.08"/>
      <rect x="52" y="44" width="96" height="128" rx="10" fill="${c}"/>
      <rect x="48" y="34" width="104" height="22" rx="6" fill="${c}"/>
      <rect x="48" y="34" width="104" height="22" rx="6" fill="#000" opacity="0.18"/>
      <rect x="58" y="84" width="84" height="52" rx="4" fill="#fffaf2" opacity="0.92"/>
      <rect x="72" y="100" width="56" height="6" rx="3" fill="${c}" opacity="0.7"/>
      <rect x="80" y="114" width="40" height="4" rx="2" fill="#2b2622" opacity="0.35"/>
      <rect x="58" y="56" width="10" height="110" rx="5" fill="#fff" opacity="0.16"/>`,
    shirt: `<ellipse cx="100" cy="176" rx="56" ry="7" fill="#000" opacity="0.08"/>
      <path d="M70 34 L48 44 L22 76 L44 92 L58 76 L58 168 L142 168 L142 76 L156 92 L178 76 L152 44 L130 34
        Q100 56 70 34 Z" fill="${c}"/>
      <path d="M70 34 Q100 56 130 34 Q100 46 70 34 Z" fill="#000" opacity="0.15"/>
      <rect x="62" y="80" width="8" height="84" rx="4" fill="#fff" opacity="0.15"/>`,
    beanie: `<ellipse cx="100" cy="170" rx="60" ry="7" fill="#000" opacity="0.08"/>
      <circle cx="100" cy="40" r="16" fill="${c}"/>
      <path d="M44 132 Q44 52 100 52 Q156 52 156 132 Z" fill="${c}"/>
      <rect x="40" y="126" width="120" height="36" rx="8" fill="${c}"/>
      <rect x="40" y="126" width="120" height="36" rx="8" fill="#000" opacity="0.18"/>
      <path d="M60 126 L60 162 M80 126 L80 162 M100 126 L100 162 M120 126 L120 162 M140 126 L140 162"
        stroke="#fff" stroke-opacity="0.2" stroke-width="3"/>`,
  };
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200" width="1200" height="1200">
    <rect width="200" height="200" fill="#f4efe6"/>${shapes[picture.shape]}</svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}

/** Legt Kategorien und Produkte eines Testshops an, wenn der Shop noch keine Produkte hat. */
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
    // Der Befehl handelt als System für genau diesen einen Shop, mit Katalogrechten.
    resolveActor: async () => ({
      actor: { type: "system" },
      tenantId: options.tenantId,
      scopes: new Set(["products:read", "products:write"]),
    }),
    logger: createLogger({ level: "silent" }),
    idempotency: databaseIdempotencyStore(options.database),
  });
  const http = app.getHttpAdapter().getInstance();
  const call = async (method: "GET" | "POST", url: string, payload?: object) => {
    const r = await http.inject({ method, url, ...(payload === undefined ? {} : { payload }) });
    if (r.statusCode >= 300) throw new Error(`${method} ${url}: ${r.statusCode} ${r.body}`);
    return r.json() as { id: string; data?: unknown[] };
  };
  try {
    const existing = await call("GET", "/admin/v1/products?limit=100");
    let created = "";
    if ((existing.data ?? []).length === 0) {
      const categoryIds = new Map<string, string>();
      for (const c of catalog.categories)
        categoryIds.set(c.slug, (await call("POST", "/admin/v1/categories", c)).id);
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
      created = `${catalog.categories.length} Kategorien und ${catalog.products.length} Produkte angelegt`;
    }
    // Bilder (M2 Teil 2): auch für Testprodukte, die schon vor den Bildern angelegt wurden.
    const products = (await call("GET", "/admin/v1/products?limit=100")).data as SeedListItem[];
    let pictures = 0;
    for (const p of catalog.products) {
      const product = products.find((x) => x.name === p.name);
      if (product === undefined || product.images.length > 0) continue;
      const data = (await seedPicture(p.picture)).toString("base64");
      await call("POST", `/admin/v1/products/${product.id}/images`, {
        data,
        filename: `${product.slug}.png`,
      });
      pictures++;
    }
    const parts = [created || "Produkte gibt es schon, bleiben unverändert"];
    if (pictures > 0) parts.push(`${pictures} Bilder hochgeladen`);
    return parts.join(", ");
  } finally {
    await app.close();
  }
}

interface SeedListItem {
  readonly id: string;
  readonly name: string;
  readonly slug: string;
  readonly images: readonly unknown[];
}
