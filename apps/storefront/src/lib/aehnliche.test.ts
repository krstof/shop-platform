import { describe, expect, it } from "vitest";
import { aehnlicheProdukte } from "./aehnliche.js";
import type { StoreProduct } from "./store-api.js";

const p = (id: string, inStock = true) => ({ id, inStock }) as StoreProduct;

describe("aehnlicheProdukte", () => {
  it("ohne das Produkt selbst, verfügbare zuerst, höchstens vier", () => {
    const liste = [p("a"), p("b", false), p("c"), p("d"), p("e"), p("f")];
    expect(aehnlicheProdukte(p("a"), liste).map((x) => x.id)).toEqual(["c", "d", "e", "f"]);
    expect(aehnlicheProdukte(p("c"), liste.slice(0, 3)).map((x) => x.id)).toEqual(["a", "b"]);
  });
  it("leer, wenn es nichts anderes gibt", () => {
    expect(aehnlicheProdukte(p("a"), [p("a")])).toEqual([]);
  });
});
