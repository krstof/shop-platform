// Ausgabeschema eines Herstellers in der Admin-API (Architektur 4.8: camelCase, ISO-Zeitpunkte).
import { timestamp } from "@shop/http";
import { z } from "zod";
import type { ManufacturerRow } from "../../internal/manufacturer-repository.js";

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
