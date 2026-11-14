import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";
import { mergeUserTurns, pageNote, visibleText } from "./assistant.js";

const SHOP = "0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b";
const ID = "0190a1b2-c3d4-7e5f-8a9b-0000000000bb";

describe("Assistent in der Seitenleiste", () => {
  it("sagt dem Modell, welche Seite offen ist", () => {
    const qc = new QueryClient();
    expect(pageNote(`/teeladen/produkte/${ID}`, SHOP, qc)).toBe(`Produkt mit ID ${ID}`);
    qc.setQueryData(["product", SHOP, ID], { name: "Sencha" });
    expect(pageNote(`/teeladen/produkte/${ID}`, SHOP, qc)).toBe(`Produkt „Sencha“ (ID ${ID})`);
    qc.setQueryData(["order", SHOP, ID], { orderNumber: "10003" });
    expect(pageNote(`/teeladen/bestellungen/${ID}`, SHOP, qc)).toBe(`Bestellung Nr. 10003 (ID ${ID})`);
    expect(pageNote("/teeladen/produkte/neu", SHOP, qc)).toBe("Formular „Neues Produkt“");
    expect(pageNote("/teeladen/bestellungen", SHOP, qc)).toBe("Bestellliste");
    expect(pageNote("/teeladen/assistent", SHOP, qc)).toBeUndefined();
  });

  it("zeigt die Hinweise für das Modell nicht in der Blase", () => {
    expect(visibleText("[Foto foto-2] [Seite: Produkt „Sencha“ (ID x)] Mach das teurer")).toBe(
      "Mach das teurer",
    );
    expect(visibleText("[Seite: Bestellliste] Hallo")).toBe("Hallo");
    expect(visibleText("Ganz normal [Seite: x]")).toBe("Ganz normal [Seite: x]");
  });

  it("legt zwei Nachrichten der Person zusammen", () => {
    const t = (text: string) => ({ type: "text" as const, text });
    expect(
      mergeUserTurns([
        { role: "user", content: [t("a")] },
        { role: "user", content: [t("b")] },
      ]),
    ).toEqual([{ role: "user", content: [t("a"), t("b")] }]);
  });
});
