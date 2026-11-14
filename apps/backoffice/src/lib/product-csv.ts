// Produkte als Tabelle (CSV) herunterladen und wieder hochladen. Gleiche Spalten in beide Richtungen,
// Semikolon und Komma als Dezimalzeichen wie im deutschen Excel. Beim Hochladen gilt: gleiche
// Artikelnummer = vorhandenes Produkt ändern, sonst neues Produkt anlegen (als Entwurf, wenn nichts steht).
import { csvCell } from "./order-filter.js";

export const CSV_COLUMNS = [
  "Name",
  "Artikelnummer",
  "Preis",
  "Angebotspreis",
  "Bestand",
  "Kategorie",
  "Im Shop",
  "Mehrwertsteuer",
  "Lieferzeit von",
  "Lieferzeit bis",
  "Beschreibung",
] as const;

interface ProductLike {
  readonly name: string;
  readonly sku: string | null;
  readonly price: { readonly amount: number } | null;
  readonly salePrice: { readonly amount: number } | null;
  readonly stock: number;
  readonly categoryId: string | null;
  readonly status: "draft" | "published";
  readonly taxClass: "standard" | "reduced";
  readonly deliveryDays?: { readonly min: number; readonly max: number } | null;
  readonly description: string;
}

const euro = (cents: number | null | undefined) =>
  cents === null || cents === undefined ? "" : (cents / 100).toFixed(2).replace(".", ",");

export function productsCsv(
  products: readonly ProductLike[],
  categoryName: (id: string | null) => string,
): string {
  const rows = [
    [...CSV_COLUMNS],
    ...products.map((p) => [
      p.name,
      p.sku ?? "",
      euro(p.price?.amount),
      euro(p.salePrice?.amount),
      p.stock,
      categoryName(p.categoryId),
      p.status === "published" ? "ja" : "nein",
      p.taxClass === "reduced" ? "7" : "19",
      p.deliveryDays?.min ?? "",
      p.deliveryDays?.max ?? "",
      p.description,
    ]),
  ];
  return `\uFEFF${rows.map((r) => r.map(csvCell).join(";")).join("\r\n")}\r\n`;
}

/** CSV in Zeilen und Zellen zerlegen (Anführungszeichen, Zeilenumbrüche in Zellen, ; oder ,). */
export function parseCsv(text: string): string[][] {
  const t = text.replace(/^\uFEFF/, "");
  const firstLine = t.split(/\r?\n/, 1)[0] ?? "";
  const sep = (firstLine.match(/;/g)?.length ?? 0) >= (firstLine.match(/,/g)?.length ?? 0) ? ";" : ",";
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (quoted) {
      if (c === '"' && t[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"' && cell === "") quoted = true;
    else if (c === sep) {
      row.push(cell);
      cell = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && t[i + 1] === "\n") i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else cell += c;
  }
  if (cell !== "" || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  return rows.filter((r) => r.some((x) => x.trim() !== ""));
}

/** Eine Zeile der Tabelle, bereit für die API. */
export interface ImportRow {
  readonly line: number;
  readonly name: string;
  readonly sku: string | null;
  readonly price: number;
  readonly salePrice: number | null;
  readonly stock: number;
  readonly categoryId: string | null;
  readonly status: "draft" | "published";
  readonly taxClass: "standard" | "reduced";
  readonly deliveryDays: { min: number; max: number } | null;
  readonly description: string | null;
  /** Vorhandenes Produkt mit gleicher Artikelnummer (wird geändert). */
  readonly existingId: string | null;
}

export interface ImportResult {
  /** Spalten der Tabelle (klein geschrieben); fehlende Spalten ändern vorhandene Produkte nicht. */
  readonly columns: readonly string[];
  readonly rows: ImportRow[];
  readonly errors: { readonly line: number; readonly message: string }[];
}

function cents(raw: string): number | undefined {
  const v = raw.trim().replace(/\s|€/g, "");
  if (v === "") return undefined;
  const norm = v.includes(",") ? v.replace(/\./g, "").replace(",", ".") : v;
  if (!/^\d+(\.\d{1,2})?$/.test(norm)) return Number.NaN;
  return Math.round(Number(norm) * 100);
}

/** Tabelle prüfen: Kopfzeile finden, jede Zeile lesen, Fehler mit Zeilennummer sammeln. */
export function readImport(
  text: string,
  existing: readonly { readonly id: string; readonly sku: string | null }[],
  categories: readonly { readonly id: string; readonly name: string }[],
): ImportResult {
  const table = parseCsv(text);
  const head = (table[0] ?? []).map((h) => h.trim().toLowerCase());
  const col = (name: string) => head.indexOf(name.toLowerCase());
  const errors: { line: number; message: string }[] = [];
  if (col("Name") < 0)
    return {
      columns: head,
      rows: [],
      errors: [{ line: 1, message: "Die Spalte „Name“ fehlt in der ersten Zeile." }],
    };
  const bySku = new Map(existing.filter((p) => p.sku).map((p) => [p.sku?.toLowerCase(), p.id]));
  const byCategory = new Map(categories.map((c) => [c.name.trim().toLowerCase(), c.id]));
  const rows: ImportRow[] = [];
  const seenSku = new Set<string>();
  table.slice(1).forEach((r, i) => {
    const line = i + 2;
    const get = (name: string) => {
      const k = col(name);
      return k < 0 ? "" : (r[k] ?? "").trim();
    };
    const name = get("Name");
    if (name === "") return errors.push({ line, message: "Name fehlt." });
    if (name.length > 200) return errors.push({ line, message: "Name ist zu lang (höchstens 200 Zeichen)." });
    const price = cents(get("Preis"));
    if (price === undefined || Number.isNaN(price) || price <= 0)
      return errors.push({ line, message: "Preis fehlt oder ist keine Zahl (z. B. 8,90)." });
    const sale = cents(get("Angebotspreis"));
    if (sale !== undefined && (Number.isNaN(sale) || sale <= 0 || sale >= price))
      return errors.push({ line, message: "Angebotspreis muss eine Zahl unter dem Preis sein." });
    const stockRaw = get("Bestand");
    const stock = stockRaw === "" ? 0 : Number(stockRaw);
    if (!Number.isInteger(stock) || stock < 0)
      return errors.push({ line, message: "Bestand muss eine ganze Zahl ab 0 sein." });
    const catName = get("Kategorie");
    const categoryId = catName === "" ? null : (byCategory.get(catName.toLowerCase()) ?? undefined);
    if (categoryId === undefined)
      return errors.push({ line, message: `Kategorie „${catName}“ gibt es nicht.` });
    const shop = get("Im Shop").toLowerCase();
    const tax = get("Mehrwertsteuer").replace("%", "").trim();
    if (tax !== "" && tax !== "7" && tax !== "19")
      return errors.push({ line, message: "Mehrwertsteuer: 7 oder 19." });
    const dmin = get("Lieferzeit von");
    const dmax = get("Lieferzeit bis");
    let deliveryDays: { min: number; max: number } | null = null;
    if (dmin !== "" || dmax !== "") {
      const a = Number(dmin || dmax);
      const b = Number(dmax || dmin);
      if (!Number.isInteger(a) || !Number.isInteger(b) || a < 0 || b < a || b > 99)
        return errors.push({ line, message: "Lieferzeit: ganze Werktage, „bis“ nicht kleiner als „von“." });
      deliveryDays = { min: a, max: b };
    }
    const sku = get("Artikelnummer") || null;
    if (sku !== null) {
      if (seenSku.has(sku.toLowerCase()))
        return errors.push({ line, message: `Artikelnummer „${sku}“ steht doppelt in der Tabelle.` });
      seenSku.add(sku.toLowerCase());
    }
    rows.push({
      line,
      name,
      sku,
      price,
      salePrice: sale ?? null,
      stock,
      categoryId,
      status: ["ja", "x", "1", "true", "yes"].includes(shop) ? "published" : "draft",
      taxClass: tax === "7" ? "reduced" : "standard",
      deliveryDays,
      description: get("Beschreibung") || null,
      existingId: sku === null ? null : (bySku.get(sku.toLowerCase()) ?? null),
    });
    return undefined;
  });
  return { columns: head, rows, errors };
}

/** Felder für die API; bei vorhandenen Produkten nur Spalten, die in der Tabelle stehen. */
export function importBody(r: ImportRow, columns: readonly string[]): Record<string, unknown> {
  const has = (c: string) => r.existingId === null || columns.includes(c.toLowerCase());
  const body: Record<string, unknown> = { name: r.name, price: { amount: r.price } };
  if (has("Beschreibung")) body["description"] = r.description;
  if (has("Angebotspreis")) body["salePrice"] = r.salePrice === null ? null : { amount: r.salePrice };
  if (has("Mehrwertsteuer")) body["taxClass"] = r.taxClass;
  if (has("Bestand")) body["stock"] = r.stock;
  if (has("Kategorie")) body["categoryId"] = r.categoryId;
  if (has("Artikelnummer")) body["sku"] = r.sku;
  if (has("Lieferzeit von") || has("Lieferzeit bis")) body["deliveryDays"] = r.deliveryDays;
  if (has("Im Shop")) body["status"] = r.status;
  return body;
}
