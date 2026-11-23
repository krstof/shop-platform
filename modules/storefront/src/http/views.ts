// Seitenaufrufe (Paket P3): Die Storefront meldet gebündelt, welche Seiten aufgerufen wurden; das
// Backoffice holt sich die Auswertung für die Analytics-Seite.
//
// Gemeldet wird vom Server der Storefront, nicht aus dem Browser: kein JavaScript, kein Cookie,
// keine IP-Adresse. Deshalb ist der Meldeweg öffentlich wie das Kontaktformular — wer ihn von Hand
// aufruft, kann die Zahlen seines eigenen Testshops aufblähen und sonst nichts.
import { defineEndpoint, type Endpoint } from "@shop/http";
import { getContext, withTenantTransaction, type Database } from "@shop/kernel";
import { z } from "zod";
import type { DB } from "../db.generated.js";
import {
  addViews,
  MAX_VIEW_COUNT,
  MAX_VIEW_ENTRIES,
  MAX_PATH,
  PAGE_KINDS,
  viewsReport,
  type PageKind,
} from "../internal/views.js";

const handle = z
  .string()
  .regex(/^[a-z0-9][a-z0-9-]{1,48}[a-z0-9]$/)
  .meta({ description: "Kennung des Shops in der Adresse." });

/** Standard und Grenzen des Zeitraums der Auswertung. */
export const DEFAULT_DAYS = 30;
export const MAX_DAYS = 365;
const MAX_TOP_PAGES = 10;

/** Die Tage des Zeitraums als `JJJJ-MM-TT` in deutscher Zeit, ältester zuerst. */
export function daysUntil(heute: Date, anzahl: number): string[] {
  const berlin = (d: Date) =>
    new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Berlin", dateStyle: "short" }).format(d);
  const aus: string[] = [];
  for (let i = anzahl - 1; i >= 0; i--) aus.push(berlin(new Date(heute.getTime() - i * 86_400_000)));
  return aus;
}

export function viewEndpoints(db: Database<DB>): Endpoint[] {
  const melden = defineEndpoint({
    api: "store",
    method: "POST",
    path: "/shops/{shopHandle}/views",
    operationId: "reportPageViews",
    summary: "Seitenaufrufe melden",
    description:
      "Meldet gebündelt, welche Seiten des Shops aufgerufen wurden. Gezählt wird auf dem Server der " +
      "Storefront, ohne Cookie und ohne etwas über einzelne Besucher zu speichern. Gespeichert ist " +
      `nur die Zahl je Seite und Tag. Höchstens ${MAX_VIEW_ENTRIES} Seiten je Meldung, höchstens ` +
      `${MAX_VIEW_COUNT} Aufrufe je Seite.`,
    tags: ["Statistik"],
    access: {
      public: true,
      reason: "Der Server der Storefront meldet ohne Konto; gespeichert wird nur eine Zahl je Seite.",
    },
    params: z.strictObject({ shopHandle: handle }),
    body: z.strictObject({
      entries: z
        .array(
          z.strictObject({
            path: z
              .string()
              .min(1)
              .max(MAX_PATH)
              .meta({ description: "Pfad ohne Shop-Kennung, z. B. /produkt/sencha." }),
            kind: z.enum(PAGE_KINDS).meta({ description: "Art der Seite." }),
            count: z.int().min(1).max(MAX_VIEW_COUNT),
          }),
        )
        .min(1)
        .max(MAX_VIEW_ENTRIES),
    }),
    bodyExample: { entries: [{ path: "/", kind: "start", count: 3 }] },
    response: {
      status: 201,
      description: "Gezählt.",
      schema: z.object({ counted: z.literal(true) }).meta({ id: "PageViewsCounted" }),
    },
    handler: async ({ body }) => {
      const tenantId = getContext()?.tenantId ?? "";
      const heute = daysUntil(new Date(), 1)[0] ?? "";
      await withTenantTransaction(db, (trx) =>
        addViews(
          trx,
          tenantId,
          heute,
          body.entries.map((e) => ({ path: e.path, kind: e.kind as PageKind, count: e.count })),
        ),
      );
      return { counted: true as const };
    },
  });

  const bericht = defineEndpoint({
    api: "admin",
    method: "GET",
    path: "/analytics/views",
    operationId: "getPageViews",
    summary: "Seitenaufrufe des Shops",
    description:
      "Aufrufe je Tag im gewählten Zeitraum (deutsche Zeit, auch Tage ohne Aufruf) und die " +
      `meistbesuchten Seiten (bis ${MAX_TOP_PAGES}). Gezählt wird ohne Cookie; es gibt deshalb ` +
      "keine Besucherzahl, sondern die Zahl der Aufrufe.",
    tags: ["Statistik"],
    access: { scopes: ["orders:read"] },
    query: z.strictObject({
      days: z.coerce
        .number()
        .int()
        .min(1)
        .max(MAX_DAYS)
        .default(DEFAULT_DAYS)
        .meta({ description: `Zeitraum in Tagen bis heute (1 bis ${MAX_DAYS}).` }),
    }),
    response: {
      status: 200,
      description: "Die Aufrufe.",
      schema: z
        .object({
          days: z.array(z.object({ date: z.iso.date(), views: z.number().int() })),
          pages: z.array(z.object({ path: z.string(), kind: z.enum(PAGE_KINDS), views: z.number().int() })),
          total: z.number().int(),
        })
        .meta({ id: "PageViews", description: "Seitenaufrufe im Zeitraum." }),
    },
    handler: async ({ query }) => {
      const tage = daysUntil(new Date(), query.days);
      const r = await withTenantTransaction(db, (trx) => viewsReport(trx, tage, MAX_TOP_PAGES));
      return { days: [...r.days], pages: [...r.pages], total: r.total };
    },
  });

  return [melden, bericht];
}
