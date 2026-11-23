// Datenzugriff für Produkte (M2): Produkt mit Standardvariante, deutschem Text und einer
// Hauptkategorie. Preis und Bestand gehören den Modulen pricing und inventory und kommen über
// deren Fassaden dazu (siehe products.ts). Läuft immer in withTenantTransaction (RLS).
import type { Transaction } from "@shop/kernel";
import type { DB } from "../db.generated.js";
import { LOCALE } from "./category-repository.js";
import { docFromText, firstFreeSlug, slugify, textFromDoc } from "./text.js";

export type ProductStatus = "draft" | "published";
export type TaxClass = "standard" | "reduced";
/** Video am Produkt (P5): eigene Datei oder ein Video bei YouTube oder Vimeo. */
export type VideoKind = "file" | "youtube" | "vimeo";
export const VIDEO_KINDS: readonly VideoKind[] = ["file", "youtube", "vimeo"];

/** Was am Produkt über das Video gespeichert ist; `null` heißt: kein Video. */
export interface ProductVideo {
  readonly kind: VideoKind;
  /** Bei einer eigenen Datei die Kennung im Modul media. */
  readonly mediaId: string | null;
  /** Bei YouTube oder Vimeo die Kennung des Videos dort. */
  readonly providerId: string | null;
  readonly autoplay: boolean;
}

/** Neu-Schildchen im Shop (P5): automatisch nach Veröffentlichungsdatum, immer oder nie. */
export type NewBadge = "auto" | "always" | "never";
export const NEW_BADGES: readonly NewBadge[] = ["auto", "always", "never"];

export interface ProductRow {
  id: string;
  status: ProductStatus;
  name: string;
  slug: string;
  description: string;
  tax_class_code: TaxClass;
  new_badge: NewBadge;
  /** Video am Produkt oder `null`. */
  video: ProductVideo | null;
  /** Eigene Suchwörter, durch Komma getrennt; `null` = keine. */
  search_keywords: string | null;
  category_id: string | null;
  /** Alle Kategorien (15.11.2026), die Hauptkategorie zuerst. */
  category_ids: string[];
  variant_id: string;
  sku: string | null;
  published_at: Date | null;
  /** Lieferzeit in Werktagen, beide `null` = nicht angegeben. */
  delivery_time_min_days: number | null;
  delivery_time_max_days: number | null;
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
      "t.search_keywords",
      "p.tax_class_code",
      "p.new_badge",
      "p.video_kind",
      "p.video_media_id",
      "p.video_provider_id",
      "p.video_autoplay",
      "pc.category_id",
      (eb) =>
        eb
          .selectFrom("catalog.product_category as x")
          .select((e) =>
            e.fn
              .agg<string[] | null>("array_agg", ["x.category_id"])
              .orderBy("x.is_primary", "desc")
              .orderBy("x.position")
              .orderBy("x.category_id")
              .as("ids"),
          )
          .whereRef("x.product_id", "=", "p.id")
          .as("category_ids"),
      "v.id as variant_id",
      "v.sku",
      "p.published_at",
      "p.delivery_time_min_days",
      "p.delivery_time_max_days",
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
    new_badge: NEW_BADGES.includes(r.new_badge as NewBadge) ? (r.new_badge as NewBadge) : "auto",
    video: VIDEO_KINDS.includes(r.video_kind as VideoKind)
      ? {
          kind: r.video_kind as VideoKind,
          mediaId: r.video_media_id,
          providerId: r.video_provider_id,
          autoplay: r.video_autoplay,
        }
      : null,
    description: textFromDoc(r.description),
    category_id: r.category_id ?? null,
    category_ids: r.category_ids ?? [],
  };
}

export interface ProductFilter {
  readonly limit: number;
  readonly afterId?: string | undefined;
  readonly status?: ProductStatus | undefined;
  readonly categoryId?: string | undefined;
  /** Sucht ohne Groß-/Kleinschreibung im Namen und in der Artikelnummer (Teiltreffer). */
  readonly search?: string | undefined;
  /** Sucht ohne Groß-/Kleinschreibung im Namen und im Text der Beschreibung (Storefront). */
  readonly searchText?: string | undefined;
}

/** Macht %, _ und \\ in einem LIKE-Muster wirkungslos, damit sie als normale Zeichen gelten. */
export function likePattern(text: string): string {
  return `%${text.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}

/** Produkte in Anlagereihenfolge (UUIDv7), eine Zeile mehr als verlangt (nächste Seite?). */
export async function findProducts(trx: Transaction<DB>, f: ProductFilter): Promise<ProductRow[]> {
  let q = baseQuery(trx)
    .orderBy("p.id")
    .limit(f.limit + 1);
  if (f.afterId !== undefined) q = q.where("p.id", ">", f.afterId);
  if (f.status !== undefined) q = q.where("p.status", "=", f.status);
  // In der Kategorie heißt: Haupt- oder weitere Kategorie (seit 15.11.2026 mehrere je Produkt).
  if (f.categoryId !== undefined) {
    const categoryId = f.categoryId;
    q = q.where((eb) =>
      eb.exists(
        eb
          .selectFrom("catalog.product_category as x")
          .select(eb.lit(1).as("eins"))
          .whereRef("x.product_id", "=", "p.id")
          .where("x.category_id", "=", categoryId),
      ),
    );
  }
  if (f.search !== undefined) {
    const pattern = likePattern(f.search);
    q = q.where((eb) =>
      eb.or([
        eb("t.name", "ilike", pattern),
        eb("v.sku", "ilike", pattern),
        eb("t.search_keywords", "ilike", pattern),
      ]),
    );
  }
  if (f.searchText !== undefined) {
    const pattern = likePattern(f.searchText);
    // Nur die Textknoten der Beschreibung, nicht die JSON-Schlüssel („paragraph“ usw.).
    q = q.where((eb) =>
      eb.or([
        eb("t.name", "ilike", pattern),
        // Suchwörter des Produkts (P5): findet es auch unter Wörtern, die nirgends im Text stehen.
        eb("t.search_keywords", "ilike", pattern),
        eb.exists(
          eb
            .selectFrom(
              eb
                .fn<{ value: string }>("jsonb_array_elements_text", [
                  eb.fn("jsonb_path_query_array", [eb.ref("t.description"), eb.val("lax $.**.text")]),
                ])
                .as("d"),
            )
            .select(eb.lit(1).as("eins"))
            .where("d.value", "ilike", pattern),
        ),
      ]),
    );
  }
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
  new_badge?: NewBadge;
  /** Video setzen oder (`null`) wegnehmen. */
  video?: ProductVideo | null;
  /** Nur das automatische Abspielen umstellen, ohne das Video zu wechseln. */
  video_autoplay?: boolean;
  /** Eigene Suchwörter, durch Komma getrennt; `null` nimmt sie weg. */
  search_keywords?: string | null;
  /** Hauptkategorie ersetzen (weitere bleiben); `null` nimmt das Produkt aus allen Kategorien. */
  category_id?: string | null;
  /** Alle Kategorien neu setzen, die erste ist die Hauptkategorie; geht vor `category_id`. */
  category_ids?: readonly string[];
  sku?: string | null;
  /** Lieferzeit in Werktagen; `null` entfernt die Angabe. */
  delivery_days?: { min: number; max: number } | null;
}

/**
 * Kategorien nach einer Änderung, Hauptkategorie zuerst: `category_ids` ersetzt alle; `category_id`
 * ersetzt nur die Hauptkategorie (ältere Aufrufer), `null` leert alles.
 */
export function categoriesOf(
  v: Pick<ProductValues, "category_id" | "category_ids">,
  current: readonly string[],
  currentPrimary: string | null = current[0] ?? null,
): string[] {
  if (v.category_ids !== undefined) return [...new Set(v.category_ids)];
  if (v.category_id === undefined) return [...current];
  if (v.category_id === null) return [];
  const others = current.filter((c) => c !== currentPrimary && c !== v.category_id);
  return [v.category_id, ...others];
}

async function setCategories(
  trx: Transaction<DB>,
  tenantId: string,
  productId: string,
  ids: readonly string[],
): Promise<void> {
  await trx.deleteFrom("catalog.product_category").where("product_id", "=", productId).execute();
  if (ids.length === 0) return;
  await trx
    .insertInto("catalog.product_category")
    .values(
      ids.map((category_id, i) => ({
        tenant_id: tenantId,
        product_id: productId,
        category_id,
        is_primary: i === 0,
        position: i,
      })),
    )
    .execute();
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
      new_badge: v.new_badge ?? "auto",
      video_kind: v.video?.kind ?? null,
      video_media_id: v.video?.mediaId ?? null,
      video_provider_id: v.video?.providerId ?? null,
      video_autoplay: v.video?.autoplay ?? v.video_autoplay ?? false,
      published_at: status === "published" ? new Date() : null,
      delivery_time_min_days: v.delivery_days?.min ?? null,
      delivery_time_max_days: v.delivery_days?.max ?? null,
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
      search_keywords: v.search_keywords ?? null,
    })
    .execute();
  await setCategories(trx, tenantId, p.id, categoriesOf(v, []));
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

  const t: { name?: string; slug?: string; description?: string; search_keywords?: string | null } = {};
  if (v.name !== undefined) t.name = v.name;
  if (v.slug !== undefined) t.slug = v.slug;
  if (v.description !== undefined) t.description = JSON.stringify(docFromText(v.description));
  if (v.search_keywords !== undefined) t.search_keywords = v.search_keywords;
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
  const categories = categoriesOf(v, before.category_ids, before.category_id);
  if (categories.join() !== before.category_ids.join()) await setCategories(trx, tenantId, id, categories);
  const firstPublish = v.status === "published" && before.published_at === null;
  await trx
    .updateTable("catalog.product")
    .set({
      ...(v.status === undefined ? {} : { status: v.status }),
      ...(v.tax_class_code === undefined ? {} : { tax_class_code: v.tax_class_code }),
      ...(v.new_badge === undefined ? {} : { new_badge: v.new_badge }),
      ...(v.video === undefined
        ? {}
        : {
            video_kind: v.video?.kind ?? null,
            video_media_id: v.video?.mediaId ?? null,
            video_provider_id: v.video?.providerId ?? null,
            video_autoplay: v.video?.autoplay ?? false,
          }),
      ...(v.video_autoplay === undefined || v.video !== undefined
        ? {}
        : { video_autoplay: v.video_autoplay }),
      ...(firstPublish ? { published_at: new Date() } : {}),
      ...(v.delivery_days === undefined
        ? {}
        : {
            delivery_time_min_days: v.delivery_days?.min ?? null,
            delivery_time_max_days: v.delivery_days?.max ?? null,
          }),
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

/**
 * „Löscht“ ein Produkt für den Händler: Es wird archiviert, nicht wirklich gelöscht, weil alte
 * Bestellungen und Warenkörbe auf seine Variante zeigen. Danach taucht es nirgends mehr auf
 * (alle Abfragen lassen `archived` weg). Artikelnummer und Kategorie werden frei, damit ein
 * neues Produkt sie wieder nutzen kann. Bilder bleiben vorerst liegen (STATUS „Später“).
 */
export async function archiveProduct(trx: Transaction<DB>, id: string): Promise<ProductRow | undefined> {
  const before = await findProductById(trx, id);
  if (before === undefined) return undefined;
  await trx.updateTable("catalog.variant").set({ sku: null }).where("product_id", "=", id).execute();
  await trx.deleteFrom("catalog.product_category").where("product_id", "=", id).execute();
  await trx
    .updateTable("catalog.product")
    .set({ status: "archived", archived_at: new Date(), updated_at: new Date() })
    .where("id", "=", id)
    .execute();
  return before;
}
