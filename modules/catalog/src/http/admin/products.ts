// Produkte in der Admin-API (M2): auflisten, lesen, anlegen, ändern. Preis und Bestand schreiben
// die Module pricing und inventory über ihre Fassaden in derselben Transaktion mit.
import { decodeCursor, defineEndpoint, idParam, listQuery, pageOf, toPage, type Endpoint } from "@shop/http";
import {
  getContext,
  NotFoundError,
  PreconditionFailedError,
  publishEvent,
  ValidationError,
  withTenantTransaction,
  type Database,
  type Transaction,
} from "@shop/kernel";
import { z } from "zod";
import { diff, productCreated, productUpdated } from "../../catalog.events.js";
import type { DB } from "../../db.generated.js";
import { categoryExists } from "../../internal/category-repository.js";
import { withConflictMapping } from "../../internal/conflicts.js";
import {
  findProductById,
  findProducts,
  freeProductSlug,
  insertProduct,
  updateProduct,
  type ProductRow,
} from "../../internal/product-repository.js";
import type { ProductPrices, ProductStock } from "../../ports.js";
import {
  createProductInput,
  CURRENCY,
  productFacts,
  productSchema,
  toProduct,
  toProductValues,
  updateProductInput,
  type Product,
} from "./product.schema.js";

const cursorKey = z.strictObject({ id: z.uuid() });

const UNKNOWN_CATEGORY = "Diese Kategorie gibt es im Shop nicht.";

export interface ProductEndpointDependencies {
  readonly db: Database<DB>;
  readonly prices: ProductPrices;
  readonly stock: ProductStock;
}

export function productEndpoints({ db, prices, stock }: ProductEndpointDependencies): Endpoint[] {
  /** Preise und Bestand zu den Zeilen holen (zwei Abfragen für die ganze Seite). */
  async function withPriceAndStock(rows: readonly ProductRow[]): Promise<Product[]> {
    const ids = rows.map((r) => r.variant_id);
    const [p, s] = await Promise.all([prices.getBasePrices(ids, CURRENCY), stock.getAvailable(ids)]);
    return rows.map((r) => toProduct(r, p.get(r.variant_id), s.get(r.variant_id)));
  }

  async function requireCategory(trx: Transaction<DB>, id: string | null | undefined): Promise<void> {
    if (id === undefined || id === null) return;
    if (!(await categoryExists(trx, id)))
      throw new ValidationError({
        detail: UNKNOWN_CATEGORY,
        errors: [{ path: "/categoryId", code: "unknown_category", message: UNKNOWN_CATEGORY }],
      });
  }

  const list = defineEndpoint({
    api: "admin",
    method: "GET",
    path: "/products",
    operationId: "listProducts",
    summary: "Produkte auflisten",
    description:
      "Listet die Produkte des Shops mit Preis und Bestand in Anlagereihenfolge, seitenweise mit " +
      "Cursor. Filter nach Status und Kategorie möglich.",
    tags: ["Produkte"],
    access: { scopes: ["products:read"] },
    query: listQuery({
      status: z.enum(["draft", "published"]).optional(),
      categoryId: z.uuid().optional(),
    }),
    response: { status: 200, description: "Eine Seite mit Produkten.", schema: pageOf(productSchema) },
    handler: async ({ query, locale }) => {
      const after = query.cursor === undefined ? undefined : decodeCursor(query.cursor, cursorKey, locale).id;
      const page = await withTenantTransaction(db, async (trx) => {
        const rows = await findProducts(trx, {
          limit: query.limit,
          afterId: after,
          status: query.status,
          categoryId: query.categoryId,
        });
        const visible = rows.slice(0, query.limit);
        const items = await withPriceAndStock(visible);
        return { rows, items };
      });
      const byId = new Map(page.items.map((p) => [p.id, p]));
      return toPage(
        page.rows,
        query.limit,
        (r) => ({ id: r.id }),
        (r) => byId.get(r.id) as Product,
      );
    },
  });

  const get = defineEndpoint({
    api: "admin",
    method: "GET",
    path: "/products/{productId}",
    operationId: "getProduct",
    summary: "Produkt lesen",
    description: "Liest ein Produkt des Shops mit Preis und Bestand.",
    tags: ["Produkte"],
    access: { scopes: ["products:read"] },
    params: z.strictObject({ productId: idParam }),
    response: { status: 200, description: "Das Produkt.", schema: productSchema },
    problems: [404],
    handler: async ({ params }) => {
      const product = await withTenantTransaction(db, async (trx) => {
        const row = await findProductById(trx, params.productId);
        return row === undefined ? undefined : (await withPriceAndStock([row]))[0];
      });
      if (product === undefined) throw new NotFoundError();
      return product;
    },
  });

  const create = defineEndpoint({
    api: "admin",
    method: "POST",
    path: "/products",
    operationId: "createProduct",
    summary: "Produkt anlegen",
    description:
      "Legt ein Produkt mit Bruttopreis, Steuersatz und Bestand an, zunächst als Entwurf (`draft`), " +
      "mit `status: published` gleich sichtbar im Shop. Ohne `slug` entsteht die Adresse aus dem " +
      "Namen. Eine schon vergebene Adresse oder Artikelnummer ergibt 409.",
    tags: ["Produkte"],
    access: { scopes: ["products:write"] },
    body: createProductInput,
    bodyExample: {
      name: "Sencha Frühlingshauch",
      description: "Ein klassischer gedämpfter Grüntee aus Shizuoka.",
      price: { amount: 890, currency: "EUR" },
      taxClass: "reduced",
      stock: 25,
      status: "published",
    },
    response: { status: 201, description: "Das angelegte Produkt.", schema: productSchema },
    problems: [409],
    handler: async ({ body }) => {
      const tenantId = getContext()?.tenantId ?? "";
      return withConflictMapping(() =>
        withTenantTransaction(db, async (trx) => {
          await requireCategory(trx, body.categoryId);
          const slug = body.slug ?? (await freeProductSlug(trx, body.name));
          const row = await insertProduct(trx, tenantId, { ...toProductValues(body), name: body.name, slug });
          await prices.setBasePrice({
            variantId: row.variant_id,
            amount: body.price.amount,
            currency: CURRENCY,
          });
          await stock.setOnHand(row.variant_id, body.stock ?? 0);
          await publishEvent(trx, productCreated, { id: row.id, name: row.name });
          return (await withPriceAndStock([row]))[0] as Product;
        }),
      );
    },
  });

  const update = defineEndpoint({
    api: "admin",
    method: "PATCH",
    path: "/products/{productId}",
    operationId: "updateProduct",
    summary: "Produkt ändern",
    description:
      "Ändert die mitgeschickten Felder eines Produkts, auch Preis und Bestand. `categoryId: null` " +
      "nimmt es aus der Kategorie. Verlangt die aktuelle Version als If-Match aus dem ETag; hat " +
      "inzwischen jemand anders geändert, kommt 412.",
    tags: ["Produkte"],
    access: { scopes: ["products:write"] },
    params: z.strictObject({ productId: idParam }),
    body: updateProductInput,
    bodyExample: { price: { amount: 950 }, stock: 40 },
    ifMatch: "required",
    response: { status: 200, description: "Das geänderte Produkt.", schema: productSchema },
    problems: [404, 409, 412, 428],
    handler: async ({ params, body, ifMatch }) => {
      const tenantId = getContext()?.tenantId ?? "";
      const result = await withConflictMapping(() =>
        withTenantTransaction(db, async (trx) => {
          await requireCategory(trx, body.categoryId);
          const r = await updateProduct(trx, tenantId, params.productId, ifMatch ?? 0, toProductValues(body));
          if (r.kind !== "updated") return r;
          const [before] = await withPriceAndStock([r.before]);
          if (body.price !== undefined)
            await prices.setBasePrice({
              variantId: r.row.variant_id,
              amount: body.price.amount,
              currency: CURRENCY,
            });
          if (body.stock !== undefined) await stock.setOnHand(r.row.variant_id, body.stock);
          const [after] = await withPriceAndStock([r.row]);
          if (before === undefined || after === undefined) throw new Error("Produkt nicht lesbar");
          const changes = diff(productFacts(before), productFacts(after));
          if (Object.keys(changes).length > 0)
            await publishEvent(trx, productUpdated, { id: r.row.id, changes });
          return { kind: "updated" as const, product: after };
        }),
      );
      if (result.kind === "not_found") throw new NotFoundError();
      if (result.kind === "version_mismatch") throw new PreconditionFailedError();
      return result.product;
    },
  });

  return [list, get, create, update];
}
