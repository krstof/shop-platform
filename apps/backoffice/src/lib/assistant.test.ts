import { describe, expect, it } from "vitest";
import {
  describeChange,
  needsConfirmation,
  prepareForSend,
  productBody,
  shippingBody,
  couponBody,
  stripImages,
  type AssistantStatus,
} from "./assistant.js";

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

  it("Versand, Gutschein, Stornieren und Notiz", () => {
    expect(shippingBody({ amountCents: 490, freeFromCents: 5000 })).toEqual({ amount: 490, freeFrom: 5000 });
    expect(shippingBody({ amountCents: 0, freeFromCents: 5000 })).toEqual({ amount: 0, freeFrom: null });
    expect(couponBody({ code: "sommer10", kind: "percent", value: 10 })).toEqual({
      code: "sommer10",
      kind: "percent",
      value: 10,
    });
    expect(couponBody({ code: "FEST5", kind: "amount", value: 500, minOrderCents: 3000 })).toMatchObject({
      minOrderAmount: 3000,
    });
    expect(describeChange("create_coupon", { code: "sommer10", kind: "percent", value: 10 }).lines).toEqual([
      "Code: SOMMER10",
      "Rabatt: 10 %",
    ]);
    expect(describeChange("cancel_order", { orderId: CAT }).title).toBe("Bestellung stornieren");
    expect(describeChange("set_order_note", { orderId: CAT, note: " " }).lines).toEqual(["Notiz löschen"]);
    expect(describeChange("update_shipping", { amountCents: 0 }).lines).toEqual(["Versand: kostenlos"]);
  });

  it("Angebotspreis setzen und beenden; Kopieren beschreiben", () => {
    expect(productBody({ salePriceCents: 690 }, false)).toEqual({ salePrice: { amount: 690 } });
    expect(productBody({ salePriceCents: null }, false)).toEqual({ salePrice: null });
    expect(productBody({ salePriceCents: "billig" }, false)).toEqual({});
    expect(describeChange("update_product", { salePriceCents: 690 }).lines).toContain(
      "Angebotspreis: 6,90\u00a0€",
    );
    expect(describeChange("update_product", { salePriceCents: null }).lines).toContain("Angebot beenden");
    expect(describeChange("copy_product", { productId: CAT }).title).toBe("Produkt kopieren");
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

describe("Fotos im Chat", () => {
  const img = (data: string) => ({
    type: "image" as const,
    source: { type: "base64" as const, media_type: "image/jpeg" as const, data },
  });
  const history = [
    { role: "user" as const, content: [img("AAAA"), { type: "text" as const, text: "[Foto foto-1] Tee" }] },
    { role: "assistant" as const, content: [{ type: "text" as const, text: "Schön." }] },
    { role: "user" as const, content: [img("BBBB"), { type: "text" as const, text: "[Foto foto-2] Tasse" }] },
    { role: "assistant" as const, content: [{ type: "text" as const, text: "Ok." }] },
    { role: "user" as const, content: [{ type: "text" as const, text: "Danke" }] },
  ];

  it("schickt nur die Fotos der letzten Nachricht mit Fotos", () => {
    const sent = prepareForSend(history);
    expect(sent[0]?.content[0]).toEqual({ type: "text", text: "(Foto, schon angesehen)" });
    expect(sent[2]?.content[0]).toEqual(img("BBBB"));
    expect(sent[4]).toEqual(history[4]);
  });

  it("speichert den Verlauf ohne Fotos", () => {
    const stored = stripImages(history);
    expect(JSON.stringify(stored)).not.toContain("BBBB");
    expect(stored[2]?.content).toEqual([
      { type: "text", text: "(Foto)" },
      { type: "text", text: "[Foto foto-2] Tasse" },
    ]);
  });

  it("beschreibt ein neues Produkt mit Foto", () => {
    expect(
      describeChange("create_product", {
        name: "Tasse",
        priceCents: 1200,
        taxClass: "standard",
        photo: "foto-2",
      }).lines,
    ).toContain("Bild: das Foto aus dem Chat");
  });
});
