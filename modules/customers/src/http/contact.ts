// Kontaktformular im Shop und Posteingang im Backoffice (15.11.2026, „Nächste Schritte“).
// Besucher schicken über /<shop>/kontakt eine Nachricht (Storefront-API, öffentlich); im Backoffice
// erscheint sie unter „Posteingang“, lässt sich als gelesen markieren, beantworten (per E-Mail-Link)
// und löschen. Bewusst einfach: keine E-Mail an den Händler, keine Antwort aus dem Backoffice heraus.
import {
  defineEndpoint,
  emailInput,
  idParam,
  multiLineText,
  singleLineText,
  type Endpoint,
} from "@shop/http";
import {
  getContext,
  NotFoundError,
  withTenantTransaction,
  type Database,
  type Transaction,
} from "@shop/kernel";
import { z } from "zod";
import type { DB } from "../db.generated.js";

const timestamp = z.string().meta({ format: "date-time" });

const messageSchema = z
  .object({
    id: z.uuid(),
    name: z.string(),
    email: z.string(),
    subject: z.string().meta({ description: "Betreff; leer, wenn keiner angegeben wurde." }),
    message: z.string(),
    read: z.boolean(),
    createdAt: timestamp,
  })
  .meta({ id: "ContactMessage", description: "Nachricht aus dem Kontaktformular des Shops." });

const handle = z
  .string()
  .regex(/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/)
  .meta({ description: "Kürzel des Shops." });

const MAX_LIST = 500;

export interface ContactDependencies {
  readonly database: Database<unknown>;
}

export function contactEndpoints(deps: ContactDependencies): Endpoint[] {
  const db = deps.database as Database<DB>;

  async function load(trx: Transaction<DB>, id?: string) {
    let q = trx
      .selectFrom("customers.contact_message")
      .select(["id", "name", "email", "subject", "message", "read_at", "created_at"])
      .orderBy("id", "desc")
      .limit(MAX_LIST);
    if (id !== undefined) q = q.where("id", "=", id);
    return (await q.execute()).map((r) => ({
      id: r.id,
      name: r.name,
      email: r.email,
      subject: r.subject,
      message: r.message,
      read: r.read_at !== null,
      createdAt: new Date(r.created_at).toISOString(),
    }));
  }

  const send = defineEndpoint({
    api: "store",
    method: "POST",
    path: "/shops/{shopHandle}/contact-messages",
    operationId: "sendStoreContactMessage",
    summary: "Nachricht an den Shop schicken",
    description:
      "Kontaktformular: Die Nachricht landet im Posteingang des Backoffice. Die Antwort enthält nur " +
      "die Bestätigung, nicht die Nachricht.",
    tags: ["Kontakt"],
    access: {
      public: true,
      reason: "Besucherinnen schreiben dem Shop ohne Konto.",
    },
    params: z.strictObject({ shopHandle: handle }),
    body: z.strictObject({
      name: singleLineText(100),
      email: emailInput(),
      subject: singleLineText(150).optional(),
      message: multiLineText(5000),
    }),
    bodyExample: {
      name: "Kim Muster",
      email: "kim@example.org",
      subject: "Frage zum Sencha",
      message: "Hallo, ist der Sencha auch in 250 g zu haben?",
    },
    response: {
      status: 201,
      description: "Angekommen.",
      schema: z.object({ received: z.literal(true) }).meta({ id: "ContactMessageReceived" }),
    },
    handler: async ({ body }) => {
      const tenantId = getContext()?.tenantId ?? "";
      await withTenantTransaction(db, (trx) =>
        trx
          .insertInto("customers.contact_message")
          .values({
            tenant_id: tenantId,
            name: body.name,
            email: body.email.trim(),
            subject: body.subject ?? "",
            message: body.message.replace(/\r\n/g, "\n"),
          })
          .execute(),
      );
      return { received: true as const };
    },
  });

  const list = defineEndpoint({
    api: "admin",
    method: "GET",
    path: "/contact-messages",
    operationId: "listContactMessages",
    summary: "Posteingang",
    description: `Nachrichten aus dem Kontaktformular, neueste zuerst (bis ${MAX_LIST}), dazu die Zahl der ungelesenen.`,
    tags: ["Kontakt"],
    access: { scopes: ["customers:read"] },
    response: {
      status: 200,
      description: "Die Nachrichten.",
      schema: z.object({ data: z.array(messageSchema), unread: z.number().int() }),
    },
    handler: async () =>
      withTenantTransaction(db, async (trx) => {
        const data = await load(trx);
        const c = await trx
          .selectFrom("customers.contact_message")
          .select((eb) => eb.fn.countAll<string>().as("n"))
          .where("read_at", "is", null)
          .executeTakeFirstOrThrow();
        return { data, unread: Number(c.n) };
      }),
  });

  const update = defineEndpoint({
    api: "admin",
    method: "PATCH",
    path: "/contact-messages/{messageId}",
    operationId: "updateContactMessage",
    summary: "Nachricht als gelesen oder ungelesen markieren",
    description: "Setzt den Lesestand einer Nachricht.",
    tags: ["Kontakt"],
    access: { scopes: ["customers:write"] },
    params: z.strictObject({ messageId: idParam }),
    body: z.strictObject({ read: z.boolean() }),
    bodyExample: { read: true },
    response: { status: 200, description: "Die Nachricht danach.", schema: messageSchema },
    problems: [404],
    handler: async ({ params, body }) =>
      withTenantTransaction(db, async (trx) => {
        // Schon gelesen bleibt beim ersten Lesezeitpunkt; nur echte Änderungen werden geschrieben.
        await trx
          .updateTable("customers.contact_message")
          .set({ read_at: body.read ? new Date() : null, updated_at: new Date() })
          .where("id", "=", params.messageId)
          .where("read_at", body.read ? "is" : "is not", null)
          .execute();
        const [m] = await load(trx, params.messageId);
        if (m === undefined) throw new NotFoundError({ detail: "Diese Nachricht gibt es nicht." });
        return m;
      }),
  });

  const remove = defineEndpoint({
    api: "admin",
    method: "DELETE",
    path: "/contact-messages/{messageId}",
    operationId: "deleteContactMessage",
    summary: "Nachricht löschen",
    description: "Löscht eine Nachricht aus dem Posteingang.",
    tags: ["Kontakt"],
    access: { scopes: ["customers:write"] },
    params: z.strictObject({ messageId: idParam }),
    response: {
      status: 200,
      description: "Gelöscht.",
      schema: z.object({ id: z.uuid(), deleted: z.literal(true) }).meta({ id: "DeletedContactMessage" }),
    },
    problems: [404],
    handler: async ({ params }) => {
      const r = await withTenantTransaction(db, (trx) =>
        trx.deleteFrom("customers.contact_message").where("id", "=", params.messageId).executeTakeFirst(),
      );
      if (r.numDeletedRows === 0n) throw new NotFoundError({ detail: "Diese Nachricht gibt es nicht." });
      return { id: params.messageId, deleted: true as const };
    },
  });

  return [send, list, update, remove];
}
