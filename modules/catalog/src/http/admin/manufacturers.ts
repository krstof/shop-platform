// Beispiel-Endpunkte des API-Gerüsts (E4): Hersteller lesen. Schreiben, ETag und If-Match folgen
// mit E4 Teil 2 und E10. Beide Endpunkte zeigen die Regeln, an die sich alle späteren halten:
// Berechtigung erklärt, strenge Eingaben, Datenzugriff nur über withTenantTransaction,
// fremde IDs ergeben 404.
import { decodeCursor, defineEndpoint, idParam, listQuery, pageOf, toPage, type Endpoint } from "@shop/http";
import { NotFoundError, withTenantTransaction, type Database } from "@shop/kernel";
import { z } from "zod";
import type { DB } from "../../db.generated.js";
import { findManufacturerById, findManufacturers } from "../../internal/manufacturer-repository.js";
import { manufacturerSchema, toManufacturer } from "./manufacturer.schema.js";

const cursorKey = z.strictObject({ id: z.uuid() });

export function manufacturerEndpoints(db: Database<DB>): Endpoint[] {
  const list = defineEndpoint({
    api: "admin",
    method: "GET",
    path: "/manufacturers",
    operationId: "listManufacturers",
    summary: "Hersteller auflisten",
    description:
      "Listet die nicht archivierten Hersteller des Shops in Anlagereihenfolge, seitenweise mit Cursor.",
    tags: ["Hersteller"],
    access: { scopes: ["products:read"] },
    query: listQuery(),
    response: { status: 200, description: "Eine Seite mit Herstellern.", schema: pageOf(manufacturerSchema) },
    handler: async ({ query, locale }) => {
      const after = query.cursor === undefined ? undefined : decodeCursor(query.cursor, cursorKey, locale).id;
      const rows = await withTenantTransaction(db, (trx) =>
        findManufacturers(trx, { limit: query.limit, afterId: after }),
      );
      return toPage(rows, query.limit, (r) => ({ id: r.id }), toManufacturer);
    },
  });

  const get = defineEndpoint({
    api: "admin",
    method: "GET",
    path: "/manufacturers/{manufacturerId}",
    operationId: "getManufacturer",
    summary: "Hersteller lesen",
    description: "Liest einen Hersteller des Shops, auch wenn er archiviert ist.",
    tags: ["Hersteller"],
    access: { scopes: ["products:read"] },
    params: z.strictObject({ manufacturerId: idParam }),
    response: { status: 200, description: "Der Hersteller.", schema: manufacturerSchema },
    problems: [404],
    handler: async ({ params }) => {
      const row = await withTenantTransaction(db, (trx) => findManufacturerById(trx, params.manufacturerId));
      if (row === undefined) throw new NotFoundError();
      return toManufacturer(row);
    },
  });

  return [list, get];
}
