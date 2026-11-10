// Datenzugriff für Produkte (M2): Produkt mit Standardvariante, deutschem Text und einer
// Hauptkategorie. Preis und Bestand gehören den Modulen pricing und inventory und kommen über
// deren Fassaden dazu (siehe products.ts). Läuft immer in withTenantTransaction (RLS).
import type { Transaction } from "@shop/kernel";
import type { DB } from "../db.generated.js";
import { LOCALE } from "./category-repository.js";
import { docFromText, firstFreeSlug, slugify, textFromDoc } from "./text.js";

export type ProductStatus = "draft" | "published";
export type TaxClass = "standard" | "reduced";

export interface ProductRow {
  id: string;
  status: ProductStatus;
  name: string;
  slug: string;
  description: string;
  tax_class_code: TaxClass;
  category_id: string | null;
  variant_id: string;
  sku: string | null;
  published_at: Date | null;
  created_at: Date;
  updated_at: Date;
  version: number;
}

function baseQuery(trx: Transaction<DB>) {
  return trx
    .selectFrom("catalog.product as p")
    .innerJoin("catalog.product_translation as t", (j) =>
      j.onRef("t.product_id", "=", "p.id").on("t.locale", "=", LOCALE),
    )
    .innerJoin("catalog.variant as v", (j) =>
      j.onRef("v.product_id", "=", "p.id").on("v.is_default", "=", true),
    )
    .leftJoin("catalog.product_category as pc", (j) =>
      j.onRef("pc.product_id", "=", "p.id").on("pc.is_primary", "=", true),
    )
    .select([
      "p.id",
      "p.status",
      "t.name",
      "t.slug",
      "t.description",
      "p.tax_class_code",
      "pc.category_id",
      "v.id as variant_id",
      "v.sku",
      "p.published_at",
      "p.created_at",
      "p.updated_at",
      "p.version",
    ])
    .where("p.status", "<>", "archived");
}

type RawRow = Awaited<ReturnType<ReturnType<typeof baseQuery>["executeTakeFirstOrThrow"]>>;

function toRow(r: RawRow): ProductRow {
  return {
    ...r,
    status: r.status === "published" ? "published" : "draft",
    tax_class_code: r.tax_class_code === "reduced" ? "reduced" : "standard",
    description: textFromDoc(r.description),
    category_id: r.category_id ?? null,
  };
}

export interface ProductFilter {
  readonly limit: number;
  readonly afterId?: string | undefined;
  readonly status?: ProductStatus | undefined;
  readonly categoryId?: string | undefined;
}

/** Produkte in Anlagereihenfolge (UUIDv7), eine Zeile mehr als verlangt (nächste Seite?). */
export async function findProducts(trx: Transaction<DB>, f: ProductFilter): Promise<ProductRow[]> {
  let q = baseQuery(trx)
    .orderBy("p.id")
    .limit(f.limit + 1);
  if (f.afterId !== undefined) q = q.where("p.id", ">", f.afterId);
  if (f.status !== undefined) q = q.where("p.status", "=", f.status);
  if (f.categoryId !== undefined) q = q.where("pc.category_id", "=", f.categoryId);
  return (await q.execute()).map(toRow);
}

export async function findProductById(trx: Transaction<DB>, id: string): Promise<ProductRow | undefined> {
  const r = await baseQuery(trx).where("p.id", "=", id).executeTakeFirst();
  return r === undefined ? undefined : toRow(r);
}

/** Freie Adresse aus dem Namen; „produkt“, wenn der Name nichts Brauchbares hergibt. */
export async function freeProductSlug(trx: Transaction<DB>, name: string): Promise<string> {
  const base = slugify(name) || "produkt";
  const rows = await trx
    .selectFrom("catalog.product_translation")
    .select("slug")
    .where("locale", "=", LOCALE)
    .where((eb) => eb.or([eb("slug", "=", base), eb("slug", "like", `${base}-%`)]))
    .execute();
  return firstFreeSlug(base, new Set(rows.map((r) => r.slug)));
}

export interface ProductValues {
  name?: string;
  slug?: string;
  description?: string | null;
  status?: ProductStatus;
  tax_class_code?: TaxClass;
  /** `null` nimmt das Produkt aus seiner Kategorie. */
  category_id?: string | null;
  sku?: string | null;
}

/** Legt Produkt, Standardvariante, Text und Kategorie an (eine Transaktion, Prüfung A-05 am Ende). */
export async function insertProduct(
  trx: Transaction<DB>,
  tenantId: string,
  v: ProductValues & { name: string; slug: string },
): Promise<ProductRow> {
  const status = v.status ?? "draft";
  const p = await trx
    .insertInto("catalog.product")
    .values({
      tenant_id: tenantId,
      status,
      tax_class_code: v.tax_class_code ?? "standard",
      published_at: status === "published" ? new Date() : null,
    })
    .returning("id")
    .executeTakeFirstOrThrow();
  await trx
    .insertInto("catalog.variant")
    .values({ tenant_id: tenantId, product_id: p.id, is_default: true, sku: v.sku ?? null })
    .execute();
  await trx
    .insertInto("catalog.product_translation")
    .values({
      tenant_id: tenantId,
      product_id: p.id,
      locale: LOCALE,
      name: v.name,
      slug: v.slug,
      description: JSON.stringify(docFromText(v.description)),
    })
    .execute();
  if (v.category_id !== undefined && v.category_id !== null) {
    await trx
      .insertInto("catalog.product_category")
      .values({ tenant_id: tenantId, product_id: p.id, category_id: v.category_id, is_primary: true })
      .execute();
  }
  const row = await findProductById(trx, p.id);
  if (row === undefined) throw new Error("Produkt nach dem Anlegen nicht lesbar");
  return row;
}

export type ProductUpdateResult =
  | { readonly kind: "updated"; readonly row: ProductRow; readonly before: ProductRow }
  | { readonly kind: "not_found" }
  | { readonly kind: "version_mismatch" };

/**
 * Ändert nur bei passender Version (Architektur 4.6). Das Produkt wird immer angefasst, damit die
 * Version jede Änderung zeigt, auch wenn sich nur Text, Kategorie, Preis oder Bestand ändern.
 */
export async function updateProduct(
  trx: Transaction<DB>,
  tenantId: string,
  id: string,
  expectedVersion: number,
  v: ProductValues,
): Promise<ProductUpdateResult> {
  const locked = await trx
    .selectFrom("catalog.product")
    .select(["version"])
    .where("id", "=", id)
    .where("status", "<>", "archived")
    .forUpdate()
    .executeTakeFirst();
  if (locked === undefined) return { kind: "not_found" };
  if (locked.version !== expectedVersion) return { kind: "version_mismatch" };
  const before = await findProductById(trx, id);
  if (before === undefined) return { kind: "not_found" };

  const t: { name?: string; slug?: string; description?: string } = {};
  if (v.name !== undefined) t.name = v.name;
  if (v.slug !== undefined) t.slug = v.slug;
  if (v.description !== undefined) t.description = JSON.stringify(docFromText(v.description));
  if (Object.keys(t).length > 0) {
    await trx
      .updateTable("catalog.product_translation")
      .set(t)
      .where("product_id", "=", id)
      .where("locale", "=", LOCALE)
      .execute();
  }
  if (v.sku !== undefined && v.sku !== before.sku) {
    await trx
      .updateTable("catalog.variant")
      .set({ sku: v.sku })
      .where("id", "=", before.variant_id)
      .execute();
  }
  if (v.category_id !== undefined && v.category_id !== before.category_id) {
    await trx.deleteFrom("catalog.product_category").where("product_id", "=", id).execute();
    if (v.category_id !== null) {
      await trx
        .insertInto("catalog.product_category")
        .values({ tenant_id: tenantId, product_id: id, category_id: v.category_id, is_primary: true })
        .execute();
    }
  }
  const firstPublish = v.status === "published" && before.published_at === null;
  await trx
    .updateTable("catalog.product")
    .set({
      ...(v.status === undefined ? {} : { status: v.status }),
      ...(v.tax_class_code === undefined ? {} : { tax_class_code: v.tax_class_code }),
      ...(firstPublish ? { published_at: new Date() } : {}),
      updated_at: new Date(),
    })
    .where("id", "=", id)
    .execute();
  const row = await findProductById(trx, id);
  if (row === undefined) return { kind: "not_found" };
  return { kind: "updated", row, before };
}

/** Veröffentlichtes Produkt zur Adresse (Storefront, M4). */
export async function findPublishedProductBySlug(
  trx: Transaction<DB>,
  slug: string,
): Promise<ProductRow | undefined> {
  const r = await baseQuery(trx)
    .where("t.slug", "=", slug)
    .where("p.status", "=", "published")
    .executeTakeFirst();
  return r === undefined ? undefined : toRow(r);
}

/** Veröffentlichte Produkte zu Produkt- oder Variantenkennungen (Warenkorb, M6). */
export async function findPublishedProductsByIds(
  trx: Transaction<DB>,
  ids: {
    readonly productIds?: readonly string[] | undefined;
    readonly variantIds?: readonly string[] | undefined;
  },
): Promise<ProductRow[]> {
  const productIds = ids.productIds ?? [];
  const variantIds = ids.variantIds ?? [];
  if (productIds.length === 0 && variantIds.length === 0) return [];
  return (
    await baseQuery(trx)
      .where("p.status", "=", "published")
      .where((eb) =>
        eb.or([
          ...(productIds.length > 0 ? [eb("p.id", "in", [...productIds])] : []),
          ...(variantIds.length > 0 ? [eb("v.id", "in", [...variantIds])] : []),
        ]),
      )
      .execute()
  ).map(toRow);
}
