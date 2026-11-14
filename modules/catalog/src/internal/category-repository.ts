// Datenzugriff für Kategorien (M2). Einfache Liste ohne Baum: Unterkategorien kommen später.
// Name, Adresse und Beschreibung stehen in category_translation (Sprache „de“, Welle 1).
// Läuft immer in einer Transaktion aus withTenantTransaction (RLS).
import type { Transaction } from "@shop/kernel";
import type { DB } from "../db.generated.js";
import { docFromText, firstFreeSlug, slugify, textFromDoc } from "./text.js";

export const LOCALE = "de";

export interface CategoryRow {
  id: string;
  name: string;
  slug: string;
  description: string;
  position: number;
  status: "visible" | "hidden";
  /** Bild für Kacheln und Kopf der Kategorieseite (Modul media), `null` = keins. */
  image_media_id: string | null;
  created_at: Date;
  updated_at: Date;
  version: number;
}

function baseQuery(trx: Transaction<DB>) {
  return trx
    .selectFrom("catalog.category as c")
    .innerJoin("catalog.category_translation as t", (j) =>
      j.onRef("t.category_id", "=", "c.id").on("t.locale", "=", LOCALE),
    )
    .select([
      "c.id",
      "t.name",
      "t.slug",
      "t.description",
      "c.position",
      "c.status",
      "c.image_media_id",
      "c.created_at",
      "c.updated_at",
      "c.version",
    ])
    .where("c.archived_at", "is", null);
}

type RawRow = Awaited<ReturnType<ReturnType<typeof baseQuery>["executeTakeFirstOrThrow"]>>;

function toRow(r: RawRow): CategoryRow {
  return {
    ...r,
    description: textFromDoc(r.description),
    status: r.status === "hidden" ? "hidden" : "visible",
  };
}

/** Kategorien nach Position, dann Anlage; eine Zeile mehr als verlangt (nächste Seite?). */
export async function findCategories(
  trx: Transaction<DB>,
  options: { readonly limit: number; readonly after?: { position: number; id: string } | undefined },
): Promise<CategoryRow[]> {
  let q = baseQuery(trx)
    .orderBy("c.position")
    .orderBy("c.id")
    .limit(options.limit + 1);
  const after = options.after;
  if (after !== undefined) {
    q = q.where((eb) =>
      eb.or([
        eb("c.position", ">", after.position),
        eb.and([eb("c.position", "=", after.position), eb("c.id", ">", after.id)]),
      ]),
    );
  }
  return (await q.execute()).map(toRow);
}

export async function findCategoryById(trx: Transaction<DB>, id: string): Promise<CategoryRow | undefined> {
  const r = await baseQuery(trx).where("c.id", "=", id).executeTakeFirst();
  return r === undefined ? undefined : toRow(r);
}

/** Freie Adresse aus dem Namen; „kategorie“, wenn der Name nichts Brauchbares hergibt. */
export async function freeCategorySlug(trx: Transaction<DB>, name: string): Promise<string> {
  const base = slugify(name) || "kategorie";
  const rows = await trx
    .selectFrom("catalog.category_translation")
    .select("slug")
    .where("locale", "=", LOCALE)
    .where((eb) => eb.or([eb("slug", "=", base), eb("slug", "like", `${base}-%`)]))
    .execute();
  return firstFreeSlug(base, new Set(rows.map((r) => r.slug)));
}

export interface CategoryValues {
  name?: string;
  slug?: string;
  description?: string | null;
  position?: number;
  status?: "visible" | "hidden";
}

export async function insertCategory(
  trx: Transaction<DB>,
  tenantId: string,
  values: CategoryValues & { name: string; slug: string },
): Promise<CategoryRow> {
  const c = await trx
    .insertInto("catalog.category")
    .values({ tenant_id: tenantId, position: values.position ?? 0, status: values.status ?? "visible" })
    .returning("id")
    .executeTakeFirstOrThrow();
  await trx
    .insertInto("catalog.category_translation")
    .values({
      tenant_id: tenantId,
      category_id: c.id,
      locale: LOCALE,
      name: values.name,
      slug: values.slug,
      description: JSON.stringify(docFromText(values.description)),
    })
    .execute();
  const row = await findCategoryById(trx, c.id);
  if (row === undefined) throw new Error("Kategorie nach dem Anlegen nicht lesbar");
  return row;
}

export type CategoryUpdateResult =
  | { readonly kind: "updated"; readonly row: CategoryRow; readonly before: CategoryRow }
  | { readonly kind: "not_found" }
  | { readonly kind: "version_mismatch" };

/** Ändert nur bei passender Version. Jede Änderung zählt die Version der Kategorie hoch. */
export async function updateCategory(
  trx: Transaction<DB>,
  id: string,
  expectedVersion: number,
  values: CategoryValues,
): Promise<CategoryUpdateResult> {
  const locked = await trx
    .selectFrom("catalog.category")
    .select(["version"])
    .where("id", "=", id)
    .where("archived_at", "is", null)
    .forUpdate()
    .executeTakeFirst();
  if (locked === undefined) return { kind: "not_found" };
  if (locked.version !== expectedVersion) return { kind: "version_mismatch" };
  const before = await findCategoryById(trx, id);
  if (before === undefined) return { kind: "not_found" };
  const t: { name?: string; slug?: string; description?: string } = {};
  if (values.name !== undefined) t.name = values.name;
  if (values.slug !== undefined) t.slug = values.slug;
  if (values.description !== undefined) t.description = JSON.stringify(docFromText(values.description));
  if (Object.keys(t).length > 0) {
    await trx
      .updateTable("catalog.category_translation")
      .set(t)
      .where("category_id", "=", id)
      .where("locale", "=", LOCALE)
      .execute();
  }
  // Die Kategorie selbst immer anfassen, damit die Version (ETag) jede Änderung zeigt.
  await trx
    .updateTable("catalog.category")
    .set({
      ...(values.position === undefined ? {} : { position: values.position }),
      ...(values.status === undefined ? {} : { status: values.status }),
      updated_at: new Date(),
    })
    .where("id", "=", id)
    .execute();
  const row = await findCategoryById(trx, id);
  if (row === undefined) return { kind: "not_found" };
  return { kind: "updated", row, before };
}

/** Gibt es die Kategorie im eigenen Shop (nicht archiviert)? */
export async function categoryExists(trx: Transaction<DB>, id: string): Promise<boolean> {
  const r = await trx
    .selectFrom("catalog.category")
    .select("id")
    .where("id", "=", id)
    .where("archived_at", "is", null)
    .executeTakeFirst();
  return r !== undefined;
}

/**
 * Löscht eine Kategorie samt Text. Ihre Produkte bleiben und sind danach ohne Kategorie
 * (Zuordnung fällt per ON DELETE CASCADE weg). Gibt die gelöschte Kategorie zurück.
 */
export async function deleteCategory(trx: Transaction<DB>, id: string): Promise<CategoryRow | undefined> {
  const before = await findCategoryById(trx, id);
  if (before === undefined) return undefined;
  await trx.deleteFrom("catalog.category").where("id", "=", id).execute();
  return before;
}

/** So viele Produkte (ohne gelöschte) hängen an der Kategorie. */
export async function countProductsInCategory(trx: Transaction<DB>, id: string): Promise<number> {
  const r = await trx
    .selectFrom("catalog.product_category as pc")
    .innerJoin("catalog.product as p", "p.id", "pc.product_id")
    .select((eb) => eb.fn.countAll<string>().as("n"))
    .where("pc.category_id", "=", id)
    .where("p.status", "<>", "archived")
    .executeTakeFirstOrThrow();
  return Number(r.n);
}

/** Setzt das Bild einer Kategorie und nennt das bisherige (zum Aufräumen). `undefined`: Kategorie fehlt. */
export async function setCategoryImage(
  trx: Transaction<DB>,
  id: string,
  mediaId: string | null,
): Promise<{ previous: string | null } | undefined> {
  const before = await trx
    .selectFrom("catalog.category")
    .select("image_media_id")
    .where("id", "=", id)
    .where("archived_at", "is", null)
    .forUpdate()
    .executeTakeFirst();
  if (before === undefined) return undefined;
  await trx
    .updateTable("catalog.category")
    .set((eb) => ({ image_media_id: mediaId, updated_at: new Date(), version: eb("version", "+", 1) }))
    .where("id", "=", id)
    .execute();
  return { previous: before.image_media_id };
}
