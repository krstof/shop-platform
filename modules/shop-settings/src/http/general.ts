// Einstellungen „Allgemein“ (14.11.2026): Adresse und Ansprechperson des Shops, USt-IdNr. und
// Handelsregister, „Shop ist geöffnet“ und der Shop-Name. Der Name gehört der Plattform (platform.tenant);
// die API-App reicht dafür Lesen und Umbenennen herein, damit dieses Modul nicht von platform abhängt.
// In der Storefront-API steht nur, ob der Shop geöffnet ist.
import { defineEndpoint, singleLineText, type Endpoint, emailInput } from "@shop/http";
import {
  getContext,
  NotFoundError,
  PreconditionFailedError,
  withTenantTransaction,
  type Database,
} from "@shop/kernel";
import { z } from "zod";
import type { DB } from "../db.generated.js";

/** Länder in der Auswahl (Welle 1: Deutschland und Nachbarn). */
export const COUNTRIES = ["DE", "AT", "CH", "NL", "BE", "LU", "FR", "DK", "PL", "CZ", "IT", "ES"] as const;

const opt = (max: number) => singleLineText(max).or(z.literal(""));

const addressSchema = z
  .object({
    company: z.string(),
    firstName: z.string(),
    lastName: z.string(),
    email: z.string(),
    phone: z.string(),
    fax: z.string(),
    country: z.enum(COUNTRIES),
    street: z.string(),
    addressLine2: z.string(),
    postalCode: z.string(),
    city: z.string(),
    region: z.string().meta({ description: "Bundesland, frei." }),
  })
  .meta({ id: "ShopAddress", description: "Adresse und Ansprechperson des Shops." });

const generalSchema = z
  .object({
    shopName: z.string(),
    shopOpen: z.boolean().meta({ description: "Geschlossen: Der Shop zeigt Besuchern nur einen Hinweis." }),
    address: addressSchema,
    vatId: z.string().meta({ description: "USt-IdNr., etwa „DE123456789“." }),
    tradeRegister: z.string().meta({ description: "Handelsregister, etwa „Amtsgericht Berlin, HRB 12345“." }),
    version: z.number().int().meta({ description: "Für If-Match beim Speichern." }),
  })
  .meta({ id: "GeneralSettings", description: "Einstellungen „Allgemein“ eines Shops." });

const required = (max: number, what: string) =>
  singleLineText(max).refine((v) => v.trim() !== "", `${what} fehlt.`);

const input = z.strictObject({
  shopName: required(100, "Shop-Name"),
  shopOpen: z.boolean(),
  address: z.strictObject({
    company: opt(200),
    firstName: required(100, "Vorname"),
    lastName: required(100, "Nachname"),
    email: emailInput(),
    phone: opt(40),
    fax: opt(40),
    country: z.enum(COUNTRIES),
    street: required(200, "Straße und Hausnummer"),
    addressLine2: opt(200),
    postalCode: required(10, "Postleitzahl"),
    city: required(100, "Stadt"),
    region: opt(100),
  }),
  vatId: z
    .string()
    .trim()
    .max(20)
    .refine(
      (v) => v === "" || /^[A-Z]{2}[A-Z0-9+*. -]{2,15}$/i.test(v),
      "Bitte eine USt-IdNr. wie DE123456789.",
    ),
  tradeRegister: opt(200),
});

export interface GeneralSettingsDependencies {
  readonly database: Database<unknown>;
  /** Name des Shops (platform.tenant). */
  readonly shopName: () => Promise<string>;
  /** Shop umbenennen (platform.tenant). */
  readonly renameShop: (name: string) => Promise<void>;
}

export function generalSettingsEndpoints(deps: GeneralSettingsDependencies): Endpoint[] {
  const db = deps.database as Database<DB>;
  const tenant = () => getContext()?.tenantId ?? "";
  const nul = (v: string) => (v.trim() === "" ? null : v.trim());

  async function view(): Promise<z.infer<typeof generalSchema>> {
    const [row, name] = await Promise.all([
      withTenantTransaction(db, (trx) =>
        trx.selectFrom("shop_settings.shop_profile").selectAll().executeTakeFirst(),
      ),
      deps.shopName(),
    ]);
    return {
      shopName: name,
      shopOpen: row === undefined || row.online_status === "online",
      address: {
        company: row?.company_name ?? "",
        firstName: row?.first_name ?? "",
        lastName: row?.last_name ?? "",
        email: row?.email ?? "",
        phone: row?.phone ?? "",
        fax: row?.fax ?? "",
        country: (COUNTRIES as readonly string[]).includes(row?.country_code ?? "")
          ? (row?.country_code as (typeof COUNTRIES)[number])
          : "DE",
        street: row?.address_line1 ?? "",
        addressLine2: row?.address_line2 ?? "",
        postalCode: row?.postal_code ?? "",
        city: row?.city ?? "",
        region: row?.region_code ?? "",
      },
      vatId: row?.vat_id ?? "",
      tradeRegister: row?.trade_register ?? "",
      version: row?.version ?? 0,
    };
  }

  const get = defineEndpoint({
    api: "admin",
    method: "GET",
    path: "/settings/general",
    operationId: "getGeneralSettings",
    summary: "Einstellungen „Allgemein“ lesen",
    description: "Adresse, Geschäftsangaben, Shop-Status und Shop-Name.",
    tags: ["Einstellungen"],
    access: { scopes: ["settings:read"] },
    response: { status: 200, description: "Die Einstellungen.", schema: generalSchema },
    handler: view,
  });

  const put = defineEndpoint({
    api: "admin",
    method: "PUT",
    path: "/settings/general",
    operationId: "updateGeneralSettings",
    summary: "Einstellungen „Allgemein“ speichern",
    description:
      "Speichert Adresse, Geschäftsangaben, Shop-Status und Shop-Name. Ein geschlossener Shop zeigt " +
      "Besuchern nur einen Hinweis. Verlangt die Version als If-Match (0 beim ersten Speichern).",
    tags: ["Einstellungen"],
    access: { scopes: ["settings:write"] },
    body: input,
    bodyExample: {
      shopName: "Teeladen",
      shopOpen: true,
      address: {
        company: "Teeladen GmbH",
        firstName: "Kim",
        lastName: "Muster",
        email: "hallo@teeladen.example",
        phone: "",
        fax: "",
        country: "DE",
        street: "Teeweg 1",
        addressLine2: "",
        postalCode: "20095",
        city: "Hamburg",
        region: "",
      },
      vatId: "DE123456789",
      tradeRegister: "Amtsgericht Hamburg, HRB 12345",
    },
    ifMatch: "required",
    response: { status: 200, description: "Die gespeicherten Einstellungen.", schema: generalSchema },
    problems: [412, 428],
    handler: async ({ body, ifMatch }) => {
      const a = body.address;
      const values = {
        company_name: nul(a.company),
        first_name: a.firstName.trim(),
        last_name: a.lastName.trim(),
        email: a.email.trim().toLowerCase(),
        phone: nul(a.phone),
        fax: nul(a.fax),
        country_code: a.country,
        address_line1: a.street.trim(),
        address_line2: nul(a.addressLine2),
        postal_code: a.postalCode.trim(),
        city: a.city.trim(),
        region_code: nul(a.region),
        vat_id: nul(body.vatId.toUpperCase().replace(/\s/g, "")),
        trade_register: nul(body.tradeRegister),
        online_status: body.shopOpen ? ("online" as const) : ("offline" as const),
        shop_name: body.shopName.trim(),
      };
      await withTenantTransaction(db, async (trx) => {
        const current = await trx
          .selectFrom("shop_settings.shop_profile")
          .select(["id", "version", "online_status"])
          .forUpdate()
          .executeTakeFirst();
        if ((current?.version ?? 0) !== ifMatch) throw new PreconditionFailedError();
        if (current === undefined)
          await trx
            .insertInto("shop_settings.shop_profile")
            .values({ tenant_id: tenant(), ...values, went_online_at: body.shopOpen ? new Date() : null })
            .execute();
        else
          await trx
            .updateTable("shop_settings.shop_profile")
            .set({
              ...values,
              version: current.version + 1,
              updated_at: new Date(),
              ...(body.shopOpen && current.online_status !== "online" ? { went_online_at: new Date() } : {}),
            })
            .where("id", "=", current.id)
            .execute();
      });
      if (body.shopName.trim() !== (await deps.shopName())) await deps.renameShop(body.shopName.trim());
      return view();
    },
  });

  const store = defineEndpoint({
    api: "store",
    method: "GET",
    path: "/shops/{shopHandle}/status",
    operationId: "getStoreStatus",
    summary: "Ist der Shop geöffnet?",
    description: "Geschlossene Shops zeigen Besuchern nur einen Hinweis.",
    tags: ["Storefront"],
    access: { public: true, reason: "Jeder Besucher muss wissen, ob der Shop geöffnet ist." },
    params: z.strictObject({
      shopHandle: z
        .string()
        .regex(/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/)
        .meta({ description: "Kürzel des Shops, etwa `teeladen`." }),
    }),
    response: {
      status: 200,
      description: "Der Status.",
      schema: z.object({ open: z.boolean() }).meta({ id: "StoreStatus" }),
    },
    problems: [404],
    handler: async () => {
      if (getContext()?.tenantId === undefined) throw new NotFoundError();
      const row = await withTenantTransaction(db, (trx) =>
        trx.selectFrom("shop_settings.shop_profile").select("online_status").executeTakeFirst(),
      );
      return { open: row === undefined || row.online_status === "online" };
    },
  });

  return [get, put, store];
}
