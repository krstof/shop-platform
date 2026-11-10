// Testprodukte (MVP-Etappe M2) für die Testshops: dieselben Teesorten wie in der Vorschau der
// Storefront (apps/storefront/src/vorschau/daten.ts), dazu ein paar Stücke für den Modeladen.
// Angelegt über die echte Admin-API (dieselben Prüfungen wie für Händler), nicht an ihr vorbei.
import type { Endpoint } from "@shop/http";
import { createLogger, type Database } from "@shop/kernel";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
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
}

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
      },
      {
        name: "Jasmin-Perlen",
        category: "gruentee",
        description:
          "Junge Blätter werden zu kleinen Perlen gerollt und mehrere Nächte mit frischen Jasminblüten beduftet. Blumig, weich und mehrfach aufgießbar.\n\nZubereitung: 4 g auf 250 ml, 80 °C, 2 Minuten.",
        price: 1450,
        taxClass: "reduced",
        stock: 12,
      },
      {
        name: "Assam Morgenstund",
        category: "schwarztee",
        description:
          "Ein vollmundiger Assam mit goldenen Spitzen. Malzig und kräftig, passt gut zu Milch und weckt zuverlässig auf.\n\nZubereitung: 3 g auf 250 ml, 95 °C, 3 bis 4 Minuten.",
        price: 690,
        taxClass: "reduced",
        stock: 40,
      },
      {
        name: "Earl Grey Classic",
        category: "schwarztee",
        description:
          "Ceylon-Schwarztee mit dem Öl der Bergamotte-Frucht. Zitrusfrisch und elegant, ein Klassiker am Nachmittag.\n\nZubereitung: 3 g auf 250 ml, 95 °C, 3 Minuten.",
        price: 1190,
        taxClass: "reduced",
        stock: 18,
      },
      {
        name: "Pfefferminze pur",
        category: "kraeutertee",
        description:
          "Große, ganze Blätter der Pfefferminze aus deutschem Anbau. Kühl, klar und ohne Zusätze, heiß oder kalt ein Genuss.\n\nZubereitung: 2 g auf 250 ml, 100 °C, 5 bis 8 Minuten.",
        price: 550,
        taxClass: "reduced",
        stock: 50,
      },
      {
        name: "Rooibos Vanille",
        category: "kraeutertee",
        description:
          "Rooibos aus den Zederbergen mit Stückchen echter Bourbon-Vanille. Rund, weich und von Natur aus süßlich.\n\nZubereitung: 3 g auf 250 ml, 100 °C, 6 Minuten.",
        price: 790,
        taxClass: "reduced",
        stock: 0,
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
      },
      {
        name: "Leinenhemd Sommer",
        category: "oberteile",
        description: "Luftiges Hemd aus reinem Leinen für warme Tage.",
        price: 4990,
        taxClass: "standard",
        stock: 15,
      },
      {
        name: "Wollmütze Fjord",
        category: "accessoires",
        description: "Warme Mütze aus Merinowolle, eine Größe für alle.",
        price: 2490,
        taxClass: "standard",
        stock: 25,
      },
    ],
  },
};

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
    const existing = await call("GET", "/admin/v1/products?limit=1");
    if ((existing.data ?? []).length > 0) return "Produkte gibt es schon, bleiben unverändert";
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
    return `${catalog.categories.length} Kategorien und ${catalog.products.length} Produkte angelegt`;
  } finally {
    await app.close();
  }
}
