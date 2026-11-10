import { describe, expect, it } from "vitest";
import type { Database } from "@shop/kernel";
import { catalogEndpoints } from "../../index.js";
import type { ManufacturerRow } from "../../internal/manufacturer-repository.js";
import {
  createManufacturerInput,
  manufacturerSchema,
  toChanges,
  toManufacturer,
  updateManufacturerInput,
} from "./manufacturer.schema.js";

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
    const unused = async (): Promise<never> => {
      throw new Error("nicht verbunden");
    };
    const endpoints = catalogEndpoints({
      database: { destroy: async () => undefined } as Database<unknown>,
      prices: { setBasePrice: unused, getBasePrices: unused },
      stock: { setOnHand: unused, getAvailable: unused },
      images: { prepare: unused, get: unused, remove: unused },
    });
    expect(endpoints.map((e) => e.operationId)).toEqual([
      "listManufacturers",
      "getManufacturer",
      "createManufacturer",
      "updateManufacturer",
      "listCategories",
      "getCategory",
      "createCategory",
      "updateCategory",
      "listProducts",
      "getProduct",
      "createProduct",
      "updateProduct",
      "addProductImage",
      "deleteProductImage",
      "reorderProductImages",
      "listStoreCategories",
      "listStoreProducts",
      "getStoreProduct",
    ]);
    // Admin-Endpunkte brauchen eine Berechtigung; die Storefront-API ist öffentlich mit Begründung.
    for (const e of endpoints)
      if (e.api === "admin") expect("scopes" in e.access && e.access.scopes.length > 0).toBe(true);
      else expect(e.api === "store" && "public" in e.access).toBe(true);
  });
});

describe("Eingaben für Hersteller (Q-02)", () => {
  it("lehnt Mass Assignment und unsichere Adressen ab", () => {
    const bad = createManufacturerInput.safeParse({
      name: "Teehaus",
      tenantId: "x",
      version: 3,
      websiteUrl: "javascript:alert(1)",
    });
    expect(bad.success).toBe(false);
    const paths = bad.error?.issues.map((i) =>
      i.code === "unrecognized_keys" ? i.keys.join(",") : i.path.join("/"),
    );
    expect(paths).toEqual(expect.arrayContaining(["tenantId,version", "websiteUrl"]));
  });

  it("verlangt einen Namen, begrenzt Längen und Ländercode", () => {
    expect(createManufacturerInput.safeParse({ name: "  " }).success).toBe(false);
    expect(createManufacturerInput.safeParse({ name: "x".repeat(201) }).success).toBe(false);
    expect(createManufacturerInput.safeParse({ name: "A", address: { countryCode: "de" } }).success).toBe(
      false,
    );
    expect(createManufacturerInput.safeParse({ name: "A", address: { zip: "1" } }).success).toBe(false);
  });

  it("Änderung: mindestens ein Feld, null leert, fehlende Felder bleiben", () => {
    expect(updateManufacturerInput.safeParse({}).success).toBe(false);
    const input = updateManufacturerInput.parse({
      email: null,
      address: { city: "Bremen" },
      euResponsiblePerson: null,
    });
    expect(toChanges(input)).toEqual({
      email: null,
      city: "Bremen",
      eu_responsible_name: null,
      eu_responsible_address: null,
      eu_responsible_email: null,
      eu_responsible_phone: null,
    });
  });
});
