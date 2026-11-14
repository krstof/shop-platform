import { describe, expect, it } from "vitest";
import { categoryMessage, categoryTargets } from "./bulk.js";
import { importBody, parseCsv, productsCsv, readImport } from "./product-csv.js";

const p = {
  name: "Sencha; grün",
  sku: "S-1",
  price: { amount: 890 },
  salePrice: null,
  stock: 5,
  categoryId: "k1",
  status: "published" as const,
  taxClass: "reduced" as const,
  deliveryDays: { min: 2, max: 3 },
  description: "Zeile 1\nZeile 2",
};

describe("Produkte als Tabelle", () => {
  it("schreibt CSV, das sich wieder einlesen lässt", () => {
    const csv = productsCsv([p], (id) => (id === "k1" ? "Grüntee" : ""));
    expect(csv.startsWith("﻿Name;Artikelnummer;Preis")).toBe(true);
    const r = readImport(csv, [{ id: "p1", sku: "s-1" }], [{ id: "k1", name: "Grüntee" }]);
    expect(r.errors).toEqual([]);
    expect(r.rows[0]).toMatchObject({
      name: "Sencha; grün",
      price: 890,
      stock: 5,
      categoryId: "k1",
      status: "published",
      taxClass: "reduced",
      deliveryDays: { min: 2, max: 3 },
      description: "Zeile 1\nZeile 2",
      existingId: "p1",
    });
  });

  it("liest auch Komma-CSV und meldet Fehler mit Zeile", () => {
    expect(parseCsv('a,b\n"x, y",2\n')).toEqual([
      ["a", "b"],
      ["x, y", "2"],
    ]);
    const r = readImport(
      "Name;Preis;Kategorie;Angebotspreis\nTee;8,90;;\n;1;;\nKaffee;abc;;\nMate;5;Gibtsnicht;\nChai;5;;6\n",
      [],
      [],
    );
    expect(r.rows.map((x) => x.name)).toEqual(["Tee"]);
    expect(r.rows[0]).toMatchObject({ status: "draft", existingId: null, price: 890 });
    expect(r.errors.map((e) => e.line)).toEqual([3, 4, 5, 6]);
    expect(readImport("Titel\nx", [], []).errors[0]?.message).toContain("Name");
    // Vorhandenes Produkt: nur Spalten aus der Tabelle ändern.
    const upd = readImport("Name;Artikelnummer;Preis\nTee;T-1;9\n", [{ id: "t", sku: "T-1" }], []);
    const [row] = upd.rows;
    if (row === undefined) throw new Error("Zeile fehlt");
    expect(importBody(row, upd.columns)).toEqual({
      name: "Tee",
      price: { amount: 900 },
      sku: "T-1",
    });
  });

  it("setzt Kategorie nur, wo sie sich ändert", () => {
    const items = [
      { id: "a", categoryId: "k1" },
      { id: "b", categoryId: null },
    ];
    expect(categoryTargets(items, new Set(["a", "b"]), "k1").map((x) => x.id)).toEqual(["b"]);
    expect(categoryMessage("Grüntee", 2, 0)).toBe("2 Produkte jetzt in „Grüntee“.");
  });
});
