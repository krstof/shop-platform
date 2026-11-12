// Kategorien in der Admin-API (M2): auflisten, lesen, anlegen, ändern. Einfache Liste ohne Baum.
import { decodeCursor, defineEndpoint, idParam, listQuery, pageOf, toPage, type Endpoint } from "@shop/http";
import {
  getContext,
  NotFoundError,
  PreconditionFailedError,
  publishEvent,
  withTenantTransaction,
  type Database,
} from "@shop/kernel";
import { z } from "zod";
import { categoryCreated, categoryDeleted, categoryUpdated, diff } from "../../catalog.events.js";
import type { DB } from "../../db.generated.js";
import {
  countProductsInCategory,
  deleteCategory,
  findCategories,
  findCategoryById,
  freeCategorySlug,
  insertCategory,
  updateCategory,
} from "../../internal/category-repository.js";
import { withConflictMapping } from "../../internal/conflicts.js";
import {
  categoryFacts,
  categorySchema,
  createCategoryInput,
  toCategory,
  toCategoryValues,
  updateCategoryInput,
} from "./category.schema.js";

const cursorKey = z.strictObject({ position: z.number().int(), id: z.uuid() });

export function categoryEndpoints(db: Database<DB>): Endpoint[] {
  const list = defineEndpoint({
    api: "admin",
    method: "GET",
    path: "/categories",
    operationId: "listCategories",
    summary: "Kategorien auflisten",
    description: "Listet die Kategorien des Shops nach Position, seitenweise mit Cursor.",
    tags: ["Kategorien"],
    access: { scopes: ["products:read"] },
    query: listQuery(),
    response: { status: 200, description: "Eine Seite mit Kategorien.", schema: pageOf(categorySchema) },
    handler: async ({ query, locale }) => {
      const after = query.cursor === undefined ? undefined : decodeCursor(query.cursor, cursorKey, locale);
      const rows = await withTenantTransaction(db, (trx) =>
        findCategories(trx, { limit: query.limit, after }),
      );
      return toPage(rows, query.limit, (r) => ({ position: r.position, id: r.id }), toCategory);
    },
  });

  const get = defineEndpoint({
    api: "admin",
    method: "GET",
    path: "/categories/{categoryId}",
    operationId: "getCategory",
    summary: "Kategorie lesen",
    description: "Liest eine Kategorie des Shops.",
    tags: ["Kategorien"],
    access: { scopes: ["products:read"] },
    params: z.strictObject({ categoryId: idParam }),
    response: { status: 200, description: "Die Kategorie.", schema: categorySchema },
    problems: [404],
    handler: async ({ params }) => {
      const row = await withTenantTransaction(db, (trx) => findCategoryById(trx, params.categoryId));
      if (row === undefined) throw new NotFoundError();
      return toCategory(row);
    },
  });

  const create = defineEndpoint({
    api: "admin",
    method: "POST",
    path: "/categories",
    operationId: "createCategory",
    summary: "Kategorie anlegen",
    description:
      "Legt eine Kategorie an. Ohne `slug` entsteht die Adresse aus dem Namen (bei Gleichstand mit " +
      "angehängter Zahl). Eine schon vergebene Adresse ergibt 409.",
    tags: ["Kategorien"],
    access: { scopes: ["products:write"] },
    body: createCategoryInput,
    bodyExample: { name: "Grüntee", description: "Frisch, grasig, manchmal leicht süß." },
    response: { status: 201, description: "Die angelegte Kategorie.", schema: categorySchema },
    problems: [409],
    handler: async ({ body }) => {
      const tenantId = getContext()?.tenantId ?? "";
      const row = await withConflictMapping(() =>
        withTenantTransaction(db, async (trx) => {
          const slug = body.slug ?? (await freeCategorySlug(trx, body.name));
          const created = await insertCategory(trx, tenantId, {
            ...toCategoryValues(body),
            name: body.name,
            slug,
          });
          await publishEvent(trx, categoryCreated, { id: created.id, name: created.name });
          return created;
        }),
      );
      return toCategory(row);
    },
  });

  const update = defineEndpoint({
    api: "admin",
    method: "PATCH",
    path: "/categories/{categoryId}",
    operationId: "updateCategory",
    summary: "Kategorie ändern",
    description:
      "Ändert die mitgeschickten Felder einer Kategorie. Verlangt die aktuelle Version als If-Match " +
      "aus dem ETag; hat inzwischen jemand anders geändert, kommt 412.",
    tags: ["Kategorien"],
    access: { scopes: ["products:write"] },
    params: z.strictObject({ categoryId: idParam }),
    body: updateCategoryInput,
    bodyExample: { name: "Grüner Tee" },
    ifMatch: "required",
    response: { status: 200, description: "Die geänderte Kategorie.", schema: categorySchema },
    problems: [404, 409, 412, 428],
    handler: async ({ params, body, ifMatch }) => {
      const result = await withConflictMapping(() =>
        withTenantTransaction(db, async (trx) => {
          const r = await updateCategory(trx, params.categoryId, ifMatch ?? 0, toCategoryValues(body));
          if (r.kind === "updated") {
            const changes = diff(categoryFacts(toCategory(r.before)), categoryFacts(toCategory(r.row)));
            if (Object.keys(changes).length > 0)
              await publishEvent(trx, categoryUpdated, { id: r.row.id, changes });
          }
          return r;
        }),
      );
      if (result.kind === "not_found") throw new NotFoundError();
      if (result.kind === "version_mismatch") throw new PreconditionFailedError();
      return toCategory(result.row);
    },
  });

  const remove = defineEndpoint({
    api: "admin",
    method: "DELETE",
    path: "/categories/{categoryId}",
    operationId: "deleteCategory",
    summary: "Kategorie löschen",
    description:
      "Löscht eine Kategorie. Ihre Produkte bleiben erhalten und sind danach ohne Kategorie; die Antwort " +
      "nennt, wie viele das waren.",
    tags: ["Kategorien"],
    access: { scopes: ["products:write"] },
    params: z.strictObject({ categoryId: idParam }),
    response: { status: 200, description: "Gelöscht.", schema: deletedCategorySchema },
    problems: [404],
    handler: async ({ params }) => {
      const result = await withTenantTransaction(db, async (trx) => {
        const products = await countProductsInCategory(trx, params.categoryId);
        const row = await deleteCategory(trx, params.categoryId);
        if (row === undefined) return undefined;
        await publishEvent(trx, categoryDeleted, { id: row.id, name: row.name });
        return { id: row.id, products };
      });
      if (result === undefined) throw new NotFoundError();
      return { id: result.id, deleted: true as const, productsWithoutCategory: result.products };
    },
  });

  return [list, get, create, update, remove];
}

const deletedCategorySchema = z
  .object({
    id: z.uuid(),
    deleted: z.literal(true),
    productsWithoutCategory: z
      .number()
      .int()
      .describe("So viele Produkte hatten diese Kategorie und sind jetzt ohne Kategorie."),
  })
  .meta({ id: "DeletedCategory", description: "Bestätigung, dass die Kategorie gelöscht ist." });
