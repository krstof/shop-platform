import { describe, expect, it } from "vitest";
import type { Database } from "@shop/kernel";
import { catalogEndpoints } from "../../index.js";
import type { ManufacturerRow } from "../../internal/manufacturer-repository.js";
import { manufacturerSchema, toManufacturer } from "./manufacturer.schema.js";

const row: ManufacturerRow = {
  id: "0192f1c4-7a1e-7c3b-8000-000000000001",
  name: "Teehaus",
  trade_name: null,
  address_line1: "Hafenstraße 1",
  address_line2: null,
  postal_code: "20457",
  city: "Hamburg",
  country_code: "DE",
  email: null,
  website_url: null,
  eu_responsible_name: null,
  eu_responsible_address: null,
  eu_responsible_email: null,
  eu_responsible_phone: null,
  archived_at: null,
  created_at: new Date("2026-11-03T10:00:00Z"),
  updated_at: new Date("2026-11-03T11:00:00Z"),
  version: 2,
};

describe("Hersteller in der Admin-API", () => {
  it("übersetzt die Zeile in camelCase und ISO-Zeitpunkte", () => {
    const m = toManufacturer(row);
    expect(m).toMatchObject({
      name: "Teehaus",
      address: { line1: "Hafenstraße 1", postalCode: "20457", city: "Hamburg", countryCode: "DE" },
      euResponsiblePerson: null,
      createdAt: "2026-11-03T10:00:00.000Z",
      version: 2,
    });
    expect(manufacturerSchema.parse(m)).toEqual(m);
  });

  it("EU-Verantwortliche erscheint, sobald eine Angabe da ist", () => {
    expect(toManufacturer({ ...row, eu_responsible_email: "eu@example.org" }).euResponsiblePerson).toEqual({
      name: null,
      address: null,
      email: "eu@example.org",
      phone: null,
    });
  });

  it("Ausgabe enthält keine internen Felder wie tenant_id oder created_by", () => {
    const withInternal = { ...toManufacturer(row), tenantId: "x", createdBy: "y" };
    expect(Object.keys(manufacturerSchema.parse(withInternal))).not.toContain("tenantId");
  });

  it("alle Endpunkte des Moduls verlangen eine Berechtigung", () => {
    const endpoints = catalogEndpoints({ database: { destroy: async () => undefined } as Database<unknown> });
    expect(endpoints.map((e) => e.operationId)).toEqual(["listManufacturers", "getManufacturer"]);
    for (const e of endpoints) expect("scopes" in e.access && e.access.scopes.length > 0).toBe(true);
  });
});
