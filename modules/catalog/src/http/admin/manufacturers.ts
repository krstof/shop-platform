// Beispiel-Endpunkte des API-Gerüsts (E4): Hersteller lesen. Schreiben, ETag und If-Match folgen
// mit E4 Teil 2 und E10. Beide Endpunkte zeigen die Regeln, an die sich alle späteren halten:
// Berechtigung erklärt, strenge Eingaben, Datenzugriff nur über withTenantTransaction,
// fremde IDs ergeben 404.
import { decodeCursor, defineEndpoint, idParam, listQuery, pageOf, toPage, type Endpoint } from "@shop/http";
import {
  getContext,
  NotFoundError,
  PreconditionFailedError,
  withTenantTransaction,
  type Database,
} from "@shop/kernel";
import { z } from "zod";
import type { DB } from "../../db.generated.js";
import {
  findManufacturerById,
  findManufacturers,
  insertManufacturer,
  updateManufacturer,
} from "../../internal/manufacturer-repository.js";
import {
  createManufacturerInput,
  manufacturerSchema,
  toChanges,
  toManufacturer,
  updateManufacturerInput,
} from "./manufacturer.schema.js";

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

  const create = defineEndpoint({
    api: "admin",
    method: "POST",
    path: "/manufacturers",
    operationId: "createManufacturer",
    summary: "Hersteller anlegen",
    description:
      "Legt einen Hersteller mit Angaben zur Produktsicherheit (GPSR) an. Mit Idempotency-Key wird eine " +
      "wiederholte Anfrage nicht doppelt ausgeführt.",
    tags: ["Hersteller"],
    access: { scopes: ["products:write"] },
    body: createManufacturerInput,
    bodyExample: {
      name: "Teehaus Hamburg GmbH",
      address: { line1: "Hafenstraße 1", postalCode: "20457", city: "Hamburg", countryCode: "DE" },
      email: "info@teehaus.example",
      websiteUrl: "https://teehaus.example",
    },
    response: { status: 201, description: "Der angelegte Hersteller.", schema: manufacturerSchema },
    handler: async ({ body }) => {
      const tenantId = getContext()?.tenantId ?? "";
      const row = await withTenantTransaction(db, (trx) =>
        insertManufacturer(trx, tenantId, { ...toChanges(body), name: body.name }),
      );
      return toManufacturer(row);
    },
  });

  const update = defineEndpoint({
    api: "admin",
    method: "PATCH",
    path: "/manufacturers/{manufacturerId}",
    operationId: "updateManufacturer",
    summary: "Hersteller ändern",
    description:
      "Ändert die mitgeschickten Felder eines Herstellers, null leert ein Feld. Verlangt die aktuelle " +
      "Version als If-Match aus dem ETag; hat inzwischen jemand anders geändert, kommt 412.",
    tags: ["Hersteller"],
    access: { scopes: ["products:write"] },
    params: z.strictObject({ manufacturerId: idParam }),
    body: updateManufacturerInput,
    bodyExample: { websiteUrl: "https://teehaus.example/hersteller" },
    ifMatch: "required",
    response: { status: 200, description: "Der geänderte Hersteller.", schema: manufacturerSchema },
    problems: [404, 412, 428],
    handler: async ({ params, body, ifMatch }) => {
      const result = await withTenantTransaction(db, (trx) =>
        updateManufacturer(trx, params.manufacturerId, ifMatch ?? 0, toChanges(body)),
      );
      if (result.kind === "not_found") throw new NotFoundError();
      if (result.kind === "version_mismatch") throw new PreconditionFailedError();
      return toManufacturer(result.row);
    },
  });

  return [list, get, create, update];
}
