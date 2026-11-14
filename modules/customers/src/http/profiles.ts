// Kundinnen und Kunden per Hand anlegen (15.11.2026, Kristof: Plus-Knopf unter „Kunden“). Eine
// „Kundenkarte“ hält Name, E-Mail, Telefon und Lieferadresse, damit man sie später etwa beim Anlegen
// einer Bestellung per Hand auswählen kann. Wer im Shop bestellt, steht weiter automatisch in der
// Kundenliste (Modul orders, GET /customers); das Backoffice führt beides zusammen.
import { defineEndpoint, idParam, singleLineText, type Endpoint, emailInput } from "@shop/http";
import {
  ConflictError,
  getContext,
  NotFoundError,
  withTenantTransaction,
  type Database,
  type Transaction,
} from "@shop/kernel";
import { z } from "zod";
import type { DB } from "../db.generated.js";

const timestamp = z.string().meta({ format: "date-time" });

const addressSchema = z.object({
  street: z.string(),
  postalCode: z.string(),
  city: z.string(),
});

const profileSchema = z
  .object({
    id: z.uuid(),
    email: z.string(),
    firstName: z.string(),
    lastName: z.string(),
    phone: z.string(),
    address: addressSchema.nullable().meta({ description: "Lieferadresse (Deutschland) oder null." }),
    createdAt: timestamp,
  })
  .meta({ id: "CustomerProfile", description: "Per Hand angelegte Kundin oder angelegter Kunde." });

const profileInput = z.strictObject({
  email: emailInput(),
  firstName: singleLineText(100),
  lastName: singleLineText(100),
  phone: z
    .string()
    .trim()
    .max(40)
    .regex(/^[0-9+()/ -]*$/, "Bitte nur Ziffern, Leerzeichen und + ( ) / -.")
    .optional(),
  address: z
    .strictObject({
      street: singleLineText(200),
      postalCode: z.string().regex(/^\d{5}$/, "Bitte eine fünfstellige Postleitzahl angeben."),
      city: singleLineText(100),
    })
    .nullable()
    .optional(),
});

export interface ProfileDependencies {
  readonly database: Database<unknown>;
}

export function profileEndpoints(deps: ProfileDependencies): Endpoint[] {
  const db = deps.database as Database<DB>;

  async function load(trx: Transaction<DB>, id?: string) {
    let q = trx
      .selectFrom("customers.customer as c")
      .leftJoin("customers.customer_address as a", (j) =>
        j.onRef("a.id", "=", "c.default_shipping_address_id").onRef("a.tenant_id", "=", "c.tenant_id"),
      )
      .select([
        "c.id",
        "c.email",
        "c.first_name",
        "c.last_name",
        "c.phone",
        "c.created_at",
        "a.address_line1",
        "a.postal_code",
        "a.city",
      ])
      .where("c.archived_at", "is", null)
      .where("c.anonymized_at", "is", null)
      .orderBy("c.id", "desc")
      .limit(5000);
    if (id !== undefined) q = q.where("c.id", "=", id);
    const rows = await q.execute();
    return rows.map((r) => ({
      id: r.id,
      email: r.email ?? "",
      firstName: r.first_name ?? "",
      lastName: r.last_name ?? "",
      phone: r.phone ?? "",
      address:
        r.address_line1 === null || r.city === null
          ? null
          : { street: r.address_line1, postalCode: r.postal_code ?? "", city: r.city },
      createdAt: new Date(r.created_at).toISOString(),
    }));
  }

  const list = defineEndpoint({
    api: "admin",
    method: "GET",
    path: "/customer-profiles",
    operationId: "listCustomerProfiles",
    summary: "Angelegte Kundinnen und Kunden",
    description:
      "Per Hand angelegte Kundinnen und Kunden (neueste zuerst, bis 5000). Wer im Shop bestellt hat, " +
      "liefert GET /customers; das Backoffice führt beide Listen über die E-Mail-Adresse zusammen.",
    tags: ["Kunden"],
    access: { scopes: ["customers:read"] },
    response: {
      status: 200,
      description: "Die angelegten Kundinnen und Kunden.",
      schema: z.object({ data: z.array(profileSchema) }),
    },
    handler: async () => ({ data: await withTenantTransaction(db, (trx) => load(trx)) }),
  });

  const create = defineEndpoint({
    api: "admin",
    method: "POST",
    path: "/customer-profiles",
    operationId: "createCustomerProfile",
    summary: "Kundin oder Kunden anlegen",
    description: "Legt eine Kundenkarte an. Gibt es die E-Mail-Adresse im Shop schon als Karte, kommt 409.",
    tags: ["Kunden"],
    access: { scopes: ["customers:write"] },
    body: profileInput,
    bodyExample: {
      email: "kim@example.org",
      firstName: "Kim",
      lastName: "Muster",
      phone: "040 123456",
      address: { street: "Teeweg 1", postalCode: "20095", city: "Hamburg" },
    },
    response: { status: 201, description: "Die angelegte Karte.", schema: profileSchema },
    problems: [409],
    handler: async ({ body }) => {
      const tenantId = getContext()?.tenantId ?? "";
      return withTenantTransaction(db, async (trx) => {
        const taken = await trx
          .selectFrom("customers.customer")
          .select("id")
          .where("email_normalized", "=", body.email.trim().toLowerCase())
          .where("anonymized_at", "is", null)
          .executeTakeFirst();
        if (taken !== undefined)
          throw new ConflictError({ detail: "Diese E-Mail-Adresse gibt es schon in den Kunden." });
        const c = await trx
          .insertInto("customers.customer")
          .values({
            tenant_id: tenantId,
            email: body.email.trim(),
            first_name: body.firstName,
            last_name: body.lastName,
            phone: body.phone === undefined || body.phone === "" ? null : body.phone,
          })
          .returning("id")
          .executeTakeFirstOrThrow();
        if (body.address) {
          const a = await trx
            .insertInto("customers.customer_address")
            .values({
              tenant_id: tenantId,
              customer_id: c.id,
              first_name: body.firstName,
              last_name: body.lastName,
              address_line1: body.address.street,
              postal_code: body.address.postalCode,
              city: body.address.city,
              country_code: "DE",
            })
            .returning("id")
            .executeTakeFirstOrThrow();
          await trx
            .updateTable("customers.customer")
            .set({ default_shipping_address_id: a.id, default_billing_address_id: a.id })
            .where("id", "=", c.id)
            .execute();
        }
        const [created] = await load(trx, c.id);
        if (created === undefined) throw new Error("Kundenkarte nach dem Anlegen nicht lesbar");
        return created;
      });
    },
  });

  const remove = defineEndpoint({
    api: "admin",
    method: "DELETE",
    path: "/customer-profiles/{customerId}",
    operationId: "deleteCustomerProfile",
    summary: "Kundenkarte löschen",
    description: "Löscht die Karte samt Adresse. Bestellungen bleiben unverändert.",
    tags: ["Kunden"],
    access: { scopes: ["customers:write"] },
    params: z.strictObject({ customerId: idParam }),
    response: {
      status: 200,
      description: "Gelöscht.",
      schema: z.object({ id: z.uuid(), deleted: z.literal(true) }).meta({ id: "DeletedCustomerProfile" }),
    },
    problems: [404],
    handler: async ({ params }) => {
      const r = await withTenantTransaction(db, (trx) =>
        trx.deleteFrom("customers.customer").where("id", "=", params.customerId).executeTakeFirst(),
      );
      if (r.numDeletedRows === 0n) throw new NotFoundError({ detail: "Diese Kundenkarte gibt es nicht." });
      return { id: params.customerId, deleted: true as const };
    },
  });

  return [list, create, remove];
}
