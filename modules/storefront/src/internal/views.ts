// Seitenaufrufe zählen und auswerten (Paket P3). Gezählt wird auf dem Server der Storefront:
// kein JavaScript im Browser, kein Cookie, keine IP-Adresse. Gespeichert ist nur, wie oft eine
// Seite an einem Tag aufgerufen wurde (storefront.page_view).
import type { Transaction } from "@shop/kernel";
import type { DB } from "../db.generated.js";

export const PAGE_KINDS = ["start", "produkt", "kategorie", "seite", "sonstige"] as const;
export type PageKind = (typeof PAGE_KINDS)[number];

/** Höchstens so viele verschiedene Seiten je Meldung, und höchstens so viele Aufrufe je Seite. */
export const MAX_VIEW_ENTRIES = 50;
export const MAX_VIEW_COUNT = 1000;
/** Wie lange ein Pfad sein darf; längere werden gekürzt. */
export const MAX_PATH = 200;

export interface ViewEntry {
  readonly path: string;
  readonly kind: PageKind;
  readonly count: number;
}

/**
 * Welche Art von Seite ist das? Der Pfad kommt ohne Shop-Kennung, also „/", „/produkt/tee" …
 * Alles Unbekannte zählt als „sonstige"; so taucht kein neuer Pfad unbemerkt als eigene Art auf.
 */
export function pageKind(path: string): PageKind {
  if (path === "/" || path === "") return "start";
  if (path.startsWith("/produkt/")) return "produkt";
  if (path.startsWith("/kategorie/")) return "kategorie";
  if (path.startsWith("/seite/")) return "seite";
  return "sonstige";
}

/**
 * Einen Pfad auf das kürzen, was in die Auswertung gehört: ohne Fragezeichen-Anhang, ohne
 * Mehrfach-Schrägstriche, höchstens 200 Zeichen. Leere Pfade werden zur Startseite.
 */
export function cleanPath(raw: string): string {
  const ohneFrage = raw.split("?")[0] ?? "";
  const ohneRaute = ohneFrage.split("#")[0] ?? "";
  const eins = ohneRaute.replace(/\/{2,}/g, "/").replace(/\/+$/, "");
  const pfad = eins === "" ? "/" : eins.startsWith("/") ? eins : `/${eins}`;
  return pfad.length > MAX_PATH ? pfad.slice(0, MAX_PATH) : pfad;
}

/** Zähler hochsetzen. Mehrere Seiten in einem Rutsch, damit die Storefront bündeln kann. */
export async function addViews(
  trx: Transaction<DB>,
  tenantId: string,
  /** Tag als `JJJJ-MM-TT` in deutscher Zeit. */
  day: string,
  entries: readonly ViewEntry[],
): Promise<void> {
  const sauber = entries
    .map((e) => ({ path: cleanPath(e.path), kind: e.kind, count: Math.min(MAX_VIEW_COUNT, e.count) }))
    .filter((e) => Number.isInteger(e.count) && e.count > 0)
    .slice(0, MAX_VIEW_ENTRIES);
  if (sauber.length === 0) return;
  // Gleiche Pfade in einer Meldung zusammenfassen: ON CONFLICT trifft sonst zweimal dieselbe Zeile.
  const summiert = new Map<string, ViewEntry>();
  for (const e of sauber) {
    const da = summiert.get(e.path);
    summiert.set(e.path, {
      path: e.path,
      kind: e.kind,
      count: Math.min(MAX_VIEW_COUNT, (da?.count ?? 0) + e.count),
    });
  }
  await trx
    .insertInto("storefront.page_view")
    .values(
      [...summiert.values()].map((e) => ({
        tenant_id: tenantId,
        day,
        path: e.path,
        kind: e.kind,
        views: BigInt(e.count),
      })),
    )
    .onConflict((oc) =>
      oc.columns(["tenant_id", "day", "path"]).doUpdateSet((eb) => ({
        // Zähler hochsetzen: der bisherige Wert plus der eben gemeldete.
        views: eb("storefront.page_view.views", "+", eb.ref("excluded.views")),
        updated_at: new Date(),
      })),
    )
    .execute();
}

export interface ViewsReport {
  /** Ein Eintrag je Tag im Zeitraum, älteste zuerst, auch Tage ohne Aufruf. */
  readonly days: readonly { readonly date: string; readonly views: number }[];
  /** Die meistbesuchten Seiten im Zeitraum. */
  readonly pages: readonly { readonly path: string; readonly kind: PageKind; readonly views: number }[];
  /** Summe im Zeitraum. */
  readonly total: number;
}

/** Auswertung für das Backoffice: Aufrufe je Tag und die meistbesuchten Seiten. */
export async function viewsReport(
  trx: Transaction<DB>,
  tage: readonly string[],
  topPages: number,
): Promise<ViewsReport> {
  // Die Grenzen als Mitternacht in der Zeitzone des Servers: So vergleicht Postgres dieselben
  // Kalendertage, die auch gespeichert wurden (die Spalte ist ein Datum ohne Uhrzeit).
  const mitternacht = (tag: string) => new Date(`${tag}T00:00:00`);
  const von = mitternacht(tage[0] ?? "1970-01-01");
  const bis = mitternacht(tage[tage.length - 1] ?? "1970-01-01");
  const proTag = await trx
    .selectFrom("storefront.page_view")
    .select(({ fn }) => ["day", fn.sum<string>("views").as("views")])
    .where("day", ">=", von)
    .where("day", "<=", bis)
    .groupBy("day")
    .execute();
  const proSeite = await trx
    .selectFrom("storefront.page_view")
    .select(({ fn }) => ["path", "kind", fn.sum<string>("views").as("views")])
    .where("day", ">=", von)
    .where("day", "<=", bis)
    .groupBy(["path", "kind"])
    .orderBy("views", "desc")
    .limit(topPages)
    .execute();

  /**
   * Die Spalte ist ein Datum. Der Treiber macht daraus je nach Fall Text oder ein Date um
   * Mitternacht in der Zeitzone des Servers; deshalb die Teile des Datums nehmen und nicht
   * toISOString, das in Zeitzonen östlich von Greenwich einen Tag zurückspringt.
   */
  const alsTag = (w: unknown): string => {
    if (!(w instanceof Date)) return String(w).slice(0, 10);
    const zwei = (n: number) => String(n).padStart(2, "0");
    return `${w.getFullYear()}-${zwei(w.getMonth() + 1)}-${zwei(w.getDate())}`;
  };
  const proTagMap = new Map(proTag.map((r) => [alsTag(r.day), Number(r.views)]));
  const days = tage.map((d) => ({ date: d, views: proTagMap.get(d) ?? 0 }));
  return {
    days,
    pages: proSeite.map((r) => ({
      path: r.path,
      kind: r.kind as PageKind,
      views: Number(r.views),
    })),
    total: days.reduce((n, d) => n + d.views, 0),
  };
}
