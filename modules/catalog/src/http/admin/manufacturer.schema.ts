// Ausgabeschema eines Herstellers in der Admin-API (Architektur 4.8: camelCase, ISO-Zeitpunkte).
import { multiLineText, singleLineText, timestamp } from "@shop/http";
import { z } from "zod";
import type { ManufacturerChanges, ManufacturerRow } from "../../internal/manufacturer-repository.js";

export const manufacturerSchema = z
  .object({
    id: z.uuid(),
    name: z.string(),
    tradeName: z.string().nullable(),
    address: z.object({
      line1: z.string().nullable(),
      line2: z.string().nullable(),
      postalCode: z.string().nullable(),
      city: z.string().nullable(),
      countryCode: z.string().length(2).nullable(),
    }),
    email: z.string().nullable(),
    websiteUrl: z.string().nullable(),
    euResponsiblePerson: z
      .object({
        name: z.string().nullable(),
        address: z.string().nullable(),
        email: z.string().nullable(),
        phone: z.string().nullable(),
      })
      .nullable()
      .meta({
        description: "Verantwortliche Person in der EU (GPSR), Pflicht bei Herstellern außerhalb der EU.",
      }),
    archivedAt: timestamp.nullable(),
    createdAt: timestamp,
    updatedAt: timestamp,
    version: z.number().int().positive(),
  })
  .meta({ id: "Manufacturer", description: "Hersteller mit Angaben zur Produktsicherheit (GPSR)." });

export type Manufacturer = z.infer<typeof manufacturerSchema>;

export function toManufacturer(row: ManufacturerRow): Manufacturer {
  const eu = [
    row.eu_responsible_name,
    row.eu_responsible_address,
    row.eu_responsible_email,
    row.eu_responsible_phone,
  ];
  return {
    id: row.id,
    name: row.name,
    tradeName: row.trade_name,
    address: {
      line1: row.address_line1,
      line2: row.address_line2,
      postalCode: row.postal_code,
      city: row.city,
      countryCode: row.country_code,
    },
    email: row.email,
    websiteUrl: row.website_url,
    euResponsiblePerson: eu.every((v) => v === null)
      ? null
      : {
          name: row.eu_responsible_name,
          address: row.eu_responsible_address,
          email: row.eu_responsible_email,
          phone: row.eu_responsible_phone,
        },
    archivedAt: row.archived_at?.toISOString() ?? null,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
    version: row.version,
  };
}

// --- Eingaben (Q-02): streng, mit Höchstlängen, ohne tenantId, id, version, createdBy ---

const text = singleLineText;
const optionalText = (max: number) => text(max).nullable().optional();

const addressInput = z.strictObject({
  line1: optionalText(200),
  line2: optionalText(200),
  postalCode: optionalText(20),
  city: optionalText(100),
  countryCode: z
    .string()
    .regex(/^[A-Z]{2}$/, "Ländercode mit zwei Großbuchstaben, zum Beispiel DE")
    .nullable()
    .optional(),
});

const euResponsibleInput = z.strictObject({
  name: optionalText(200),
  address: multiLineText(500).nullable().optional(),
  email: z.email().max(254).nullable().optional(),
  phone: optionalText(50),
});

const fields = {
  tradeName: optionalText(200),
  address: addressInput.optional(),
  email: z.email().max(254).nullable().optional(),
  websiteUrl: z
    .url({ protocol: /^https?$/ })
    .max(500)
    .nullable()
    .optional(),
  euResponsiblePerson: euResponsibleInput.nullable().optional(),
};

export const createManufacturerInput = z.strictObject({ name: text(200), ...fields });
export const updateManufacturerInput = z
  .strictObject({ name: text(200).optional(), ...fields })
  .refine((v) => Object.keys(v).length > 0, "Mindestens ein Feld ändern.")
  .meta({ minProperties: 1 });

export type CreateManufacturerInput = z.output<typeof createManufacturerInput>;
export type UpdateManufacturerInput = z.output<typeof updateManufacturerInput>;

/** Übersetzt die Eingabe in Spalten. Nur mitgeschickte Felder werden gesetzt, `null` leert ein Feld. */
export function toChanges(input: UpdateManufacturerInput): ManufacturerChanges {
  const c: ManufacturerChanges = {};
  if (input.name !== undefined) c.name = input.name;
  if (input.tradeName !== undefined) c.trade_name = input.tradeName;
  if (input.email !== undefined) c.email = input.email;
  if (input.websiteUrl !== undefined) c.website_url = input.websiteUrl;
  const a = input.address;
  if (a !== undefined) {
    if (a.line1 !== undefined) c.address_line1 = a.line1;
    if (a.line2 !== undefined) c.address_line2 = a.line2;
    if (a.postalCode !== undefined) c.postal_code = a.postalCode;
    if (a.city !== undefined) c.city = a.city;
    if (a.countryCode !== undefined) c.country_code = a.countryCode;
  }
  const eu = input.euResponsiblePerson;
  if (eu === null) {
    c.eu_responsible_name = null;
    c.eu_responsible_address = null;
    c.eu_responsible_email = null;
    c.eu_responsible_phone = null;
  } else if (eu !== undefined) {
    if (eu.name !== undefined) c.eu_responsible_name = eu.name;
    if (eu.address !== undefined) c.eu_responsible_address = eu.address;
    if (eu.email !== undefined) c.eu_responsible_email = eu.email;
    if (eu.phone !== undefined) c.eu_responsible_phone = eu.phone;
  }
  return c;
}
