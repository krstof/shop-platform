import { describe, expect, it } from "vitest";
import { describeChange, needsConfirmation, productBody, type AssistantStatus } from "./assistant.js";

const CAT = "0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b";

describe("Werkzeuge des Assistenten im Backoffice", () => {
  it("baut den Inhalt für ein neues Produkt, standardmäßig als Entwurf", () => {
    expect(
      productBody({ name: " Earl Grey ", priceCents: 690, taxClass: "reduced", stock: 50 }, true),
    ).toEqual({
      name: "Earl Grey",
      price: { amount: 690 },
      taxClass: "reduced",
      stock: 50,
      status: "draft",
    });
    expect(
      productBody({ name: "X", priceCents: 1, taxClass: "standard", published: true }, true),
    ).toMatchObject({
      status: "published",
    });
  });

  it("übernimmt beim Ändern nur gültige, mitgeschickte Felder", () => {
    expect(productBody({ productId: CAT, priceCents: 950 }, false)).toEqual({ price: { amount: 950 } });
    expect(productBody({ categoryId: null, published: false }, false)).toEqual({
      categoryId: null,
      status: "draft",
    });
    expect(
      productBody({ priceCents: 9.5, stock: "viel", taxClass: "0 %", evil: "x", categoryId: CAT }, false),
    ).toEqual({
      categoryId: CAT,
    });
  });

  it("beschreibt Änderungen in einfachen Worten", () => {
    expect(
      describeChange("create_product", {
        name: "Earl Grey",
        priceCents: 690,
        taxClass: "reduced",
        stock: 50,
      }),
    ).toEqual({
      title: "Produkt anlegen",
      lines: [
        "Name: Earl Grey",
        "Preis: 6,90\u00a0€",
        "Steuer: 7 %",
        "Bestand: 50",
        "Im Shop: nein, erst als Entwurf",
      ],
    });
    expect(describeChange("update_product", { productId: CAT, priceCents: 950 }).lines).toEqual([
      "Neuer Preis: 9,50\u00a0€",
    ]);
    expect(describeChange("mark_order_shipped", { orderId: CAT }).title).toBe(
      "Bestellung als versendet markieren",
    );
  });

  it("fragt nach, wenn ein Werkzeug ändert oder unbekannt ist", () => {
    const status: AssistantStatus = {
      available: true,
      model: "m",
      dailyLimit: 1,
      usedToday: 0,
      tools: [
        { name: "search_orders", changes: false },
        { name: "create_product", changes: true },
      ],
    };
    expect(needsConfirmation("search_orders", status)).toBe(false);
    expect(needsConfirmation("create_product", status)).toBe(true);
    expect(needsConfirmation("etwas_neues", status)).toBe(true);
    expect(needsConfirmation("search_orders", undefined)).toBe(true);
  });
});
