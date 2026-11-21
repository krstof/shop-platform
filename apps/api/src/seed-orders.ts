// Bestellungen und Kontaktnachrichten als Testdaten (21.11.2026, Wunsch von Kristof: „leg mal 20
// Bestellungen an und ein paar Nachrichten“). Ohne sie sehen Bestellliste, Filter, Dashboard,
// Kundenliste, Posteingang und die Plattform-Kennzahlen leer aus, und man kann nichts ausprobieren.
//
// Angelegt über die echten Schnittstellen: Bestellungen über „Bestellung per Hand anlegen“
// (POST /admin/v1/orders, zieht Bestand ab und rechnet Steuer und Versand wie im Shop), Nachrichten
// über das öffentliche Kontaktformular des Shops. Läuft nur, solange der Shop noch keine Bestellung
// bzw. keine Nachricht hat, damit eigene Versuche nicht überschrieben werden.
import type { Endpoint } from "@shop/http";
import { createLogger, type Database } from "@shop/kernel";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { createApi } from "./app.js";
import { databaseIdempotencyStore } from "./idempotency-store.js";

interface SeedAddress {
  readonly firstName: string;
  readonly lastName: string;
  readonly street: string;
  readonly postalCode: string;
  readonly city: string;
}

interface SeedOrder {
  readonly email: string;
  readonly address: SeedAddress;
  /** Produktname und Menge; der Name muss zu einem Testprodukt des Shops passen. */
  readonly lines: readonly { readonly product: string; readonly quantity: number }[];
  /** Schon bezahlt? Unbezahlte Bestellungen stehen im Backoffice auf „Wartet auf Zahlung“. */
  readonly paid: boolean;
  /** Bezahlte Bestellung zusätzlich als versendet markieren. */
  readonly shipped?: boolean;
  readonly note?: string;
}

interface SeedMessage {
  readonly name: string;
  readonly email: string;
  readonly subject: string;
  readonly message: string;
}

const PERSONS: readonly (readonly [string, string, string, string, string])[] = [
  ["Kim", "Berger", "Teeweg 1", "20095", "Hamburg"],
  ["Lena", "Hofmann", "Lindenallee 14", "10115", "Berlin"],
  ["Jonas", "Kraus", "Am Markt 7", "04109", "Leipzig"],
  ["Mira", "Sadiq", "Rosenstraße 23", "50667", "Köln"],
  ["Tobias", "Wenzel", "Hafenstraße 5", "28195", "Bremen"],
  ["Anke", "Ritter", "Bergweg 11", "70173", "Stuttgart"],
  ["Paul", "Ebert", "Mühlgasse 2", "01067", "Dresden"],
  ["Sofia", "Lorenz", "Kirchplatz 9", "80331", "München"],
  ["Nils", "Baumann", "Deichstraße 31", "24103", "Kiel"],
  ["Clara", "Vogt", "Gartenstraße 18", "60311", "Frankfurt am Main"],
  ["Erik", "Thiele", "Schulstraße 4", "99084", "Erfurt"],
  ["Hanna", "Moser", "Uferweg 27", "18055", "Rostock"],
];

/** Baut eine Adresse aus der Liste oben. */
function person(index: number): { email: string; address: SeedAddress } {
  const entry = PERSONS[index % PERSONS.length];
  if (entry === undefined) throw new Error("Testperson fehlt");
  const [firstName, lastName, street, postalCode, city] = entry;
  const local = `${firstName}.${lastName}`
    .toLowerCase()
    .replaceAll("ä", "ae")
    .replaceAll("ö", "oe")
    .replaceAll("ü", "ue")
    .replaceAll("ß", "ss");
  return { email: `${local}@example.org`, address: { firstName, lastName, street, postalCode, city } };
}

/** Baut eine Bestellung: Person aus der Liste oben, Positionen als [Produktname, Menge]. */
function order(
  index: number,
  lines: readonly (readonly [string, number])[],
  paid: boolean,
  extra: { readonly shipped?: boolean; readonly note?: string } = {},
): SeedOrder {
  return {
    ...person(index),
    lines: lines.map(([product, quantity]) => ({ product, quantity })),
    paid,
    ...(extra.shipped === true ? { shipped: true } : {}),
    ...(extra.note === undefined ? {} : { note: extra.note }),
  };
}

/**
 * Bestellungen des Teeladens: 20 Stück über die sechs Teesorten verteilt, mit allen drei Ständen
 * (versendet, bezahlt und zu versenden, wartet auf Zahlung). Die Mengen bleiben deutlich unter dem
 * Bestand, damit nach den Testdaten noch genug zum Ausprobieren da ist.
 */
const TEELADEN_ORDERS: readonly SeedOrder[] = [
  order(0, [["Sencha Frühlingshauch", 2]], true, { shipped: true }),
  order(
    1,
    [
      ["Earl Grey Classic", 1],
      ["Pfefferminze pur", 2],
    ],
    true,
    { shipped: true },
  ),
  order(2, [["Assam Morgenstund", 3]], true, { shipped: true }),
  order(3, [["Jasmin-Perlen", 1]], true, { shipped: true, note: "Bitte als Geschenk verpacken." }),
  order(4, [["Pfefferminze pur", 1]], true, { shipped: true }),
  order(
    5,
    [
      ["Sencha Frühlingshauch", 1],
      ["Assam Morgenstund", 1],
    ],
    true,
    { shipped: true },
  ),
  order(6, [["Earl Grey Classic", 2]], true, { shipped: true }),
  order(7, [["Assam Morgenstund", 1]], true, { shipped: true }),
  order(8, [["Jasmin-Perlen", 2]], true),
  order(9, [["Pfefferminze pur", 3]], true),
  order(10, [["Sencha Frühlingshauch", 1]], true, { note: "Lieferung bitte an die Nachbarin." }),
  order(
    11,
    [
      ["Earl Grey Classic", 1],
      ["Jasmin-Perlen", 1],
    ],
    true,
  ),
  order(12, [["Assam Morgenstund", 2]], true),
  order(
    13,
    [
      ["Pfefferminze pur", 1],
      ["Sencha Frühlingshauch", 1],
    ],
    true,
  ),
  order(14, [["Earl Grey Classic", 1]], true),
  order(
    15,
    [
      ["Assam Morgenstund", 1],
      ["Pfefferminze pur", 1],
    ],
    false,
  ),
  order(16, [["Sencha Frühlingshauch", 2]], false),
  order(17, [["Jasmin-Perlen", 1]], false),
  order(18, [["Earl Grey Classic", 1]], false),
  order(19, [["Pfefferminze pur", 2]], false),
];

/** Bestellungen des Modeladens: acht Stück, ebenfalls mit allen drei Ständen. */
const MODELADEN_ORDERS: readonly SeedOrder[] = [
  order(3, [["T-Shirt Basic", 2]], true, { shipped: true }),
  order(4, [["Leinenhemd Sommer", 1]], true, { shipped: true }),
  order(
    5,
    [
      ["Wollmütze Fjord", 1],
      ["T-Shirt Basic", 1],
    ],
    true,
    { shipped: true },
  ),
  order(6, [["T-Shirt Basic", 3]], true),
  order(7, [["Wollmütze Fjord", 2]], true, { note: "Zwei verschiedene Farben wären schön." }),
  order(
    8,
    [
      ["Leinenhemd Sommer", 1],
      ["T-Shirt Basic", 1],
    ],
    true,
  ),
  order(9, [["T-Shirt Basic", 1]], false),
  order(10, [["Wollmütze Fjord", 1]], false),
];

const TEELADEN_MESSAGES: readonly SeedMessage[] = [
  {
    name: "Sabine Krüger",
    email: "sabine.krueger@example.org",
    subject: "Sencha auch in größeren Dosen?",
    message:
      "Guten Tag, wir trinken den Sencha im Büro und sind alle zwei Wochen durch. Gibt es die Sorte " +
      "auch in einer größeren Packung, und wie lange hält sie sich dann?",
  },
  {
    name: "Mehmet Yildiz",
    email: "mehmet.yildiz@example.org",
    subject: "Bestellung noch ändern",
    message:
      "Hallo, ich habe heute Morgen bestellt und dabei die Hausnummer vergessen. Richtig ist " +
      "Hafenstraße 5a. Könnt ihr das noch anpassen, bevor das Paket rausgeht? Danke!",
  },
  {
    name: "Nora Lindqvist",
    email: "nora.lindqvist@example.org",
    subject: "Koffein im Rooibos",
    message:
      "Hallo zusammen, ist der Rooibos Vanille wirklich komplett koffeinfrei? Ich trinke ihn gern " +
      "abends und möchte sichergehen.",
  },
  {
    name: "Jens Abt",
    email: "jens.abt@example.org",
    subject: "Danke",
    message:
      "Ich wollte nur kurz sagen, dass der Assam der beste ist, den ich seit Jahren getrunken habe. " +
      "Weiter so, ich bestelle bestimmt wieder.",
  },
];

const MODELADEN_MESSAGES: readonly SeedMessage[] = [
  {
    name: "Pia Reinhold",
    email: "pia.reinhold@example.org",
    subject: "Leinenhemd in Größe L",
    message:
      "Hallo, fällt das Leinenhemd eher groß oder klein aus? Ich bin unsicher zwischen M und L und " +
      "möchte ungern zurückschicken.",
  },
  {
    name: "Ousmane Diallo",
    email: "ousmane.diallo@example.org",
    subject: "Wolle der Mütze",
    message: "Guten Tag, ist die Wollmütze mulesingfrei? Falls ja, würde ich gleich zwei nehmen.",
  },
];

export const SEED_ORDERS: Readonly<Record<string, readonly SeedOrder[]>> = {
  teeladen: TEELADEN_ORDERS,
  modeladen: MODELADEN_ORDERS,
};

export const SEED_MESSAGES: Readonly<Record<string, readonly SeedMessage[]>> = {
  teeladen: TEELADEN_MESSAGES,
  modeladen: MODELADEN_MESSAGES,
};

interface ListResponse {
  readonly data?: readonly { readonly id: string; readonly name?: string }[];
}

/**
 * Legt Bestellungen und Kontaktnachrichten eines Testshops an, wenn es dort noch keine gibt.
 * Gibt zurück, was angelegt wurde (leer, wenn nichts zu tun war).
 */
export async function seedOrders(options: {
  readonly database: Database<unknown>;
  readonly endpoints: readonly Endpoint[];
  readonly tenantId: string;
  readonly handle: string;
}): Promise<string> {
  const orders = SEED_ORDERS[options.handle] ?? [];
  const messages = SEED_MESSAGES[options.handle] ?? [];
  if (orders.length === 0 && messages.length === 0) return "";
  const app: NestFastifyApplication = await createApi({
    endpoints: options.endpoints,
    resolveActor: async () => ({
      actor: { type: "system" },
      tenantId: options.tenantId,
      scopes: new Set(["products:read", "orders:read", "orders:write", "customers:read", "customers:write"]),
    }),
    // Das Kontaktformular ist ein Store-Endpunkt: Er findet den Shop über den Kurznamen im Pfad.
    storeShops: async (handle) => (handle === options.handle ? options.tenantId : undefined),
    logger: createLogger({ level: "silent" }),
    idempotency: databaseIdempotencyStore(options.database),
  });
  const http = app.getHttpAdapter().getInstance();
  const call = async (method: "GET" | "POST", url: string, payload?: object) => {
    const r = await http.inject({ method, url, ...(payload === undefined ? {} : { payload }) });
    if (r.statusCode >= 300) throw new Error(`${method} ${url}: ${r.statusCode} ${r.body}`);
    return r.json() as { id: string } & ListResponse;
  };
  try {
    const parts: string[] = [];
    const existing = await call("GET", "/admin/v1/orders?limit=1");
    if ((existing.data ?? []).length === 0 && orders.length > 0) {
      const products = (await call("GET", "/admin/v1/products?limit=100")).data ?? [];
      const idByName = new Map(products.map((p) => [p.name ?? "", p.id]));
      let placed = 0;
      let shipped = 0;
      for (const order of orders) {
        const lines = order.lines.flatMap((l) => {
          const productId = idByName.get(l.product);
          return productId === undefined ? [] : [{ productId, quantity: l.quantity }];
        });
        if (lines.length === 0) continue;
        const created = await call("POST", "/admin/v1/orders", {
          email: order.email,
          address: order.address,
          lines,
          paid: order.paid,
          ...(order.note === undefined ? {} : { note: order.note }),
        });
        placed++;
        if (order.shipped === true) {
          await call("POST", `/admin/v1/orders/${created.id}/ship`);
          shipped++;
        }
      }
      parts.push(`${placed} Bestellungen angelegt (davon ${shipped} versendet)`);
    }
    const inbox = await call("GET", "/admin/v1/contact-messages");
    if ((inbox.data ?? []).length === 0 && messages.length > 0) {
      for (const m of messages)
        await call("POST", `/store/v1/shops/${options.handle}/contact-messages`, {
          name: m.name,
          email: m.email,
          subject: m.subject,
          message: m.message,
        });
      parts.push(`${messages.length} Nachrichten im Posteingang`);
    }
    return parts.join(", ");
  } finally {
    await app.close();
  }
}
