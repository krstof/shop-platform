import { describe, expect, it } from "vitest";
import { bulkMessage, bulkTargets } from "./bulk.js";

const items = [
  { id: "a", status: "published" as const },
  { id: "b", status: "draft" as const },
  { id: "c", status: "draft" as const },
];

describe("Mehrfachauswahl", () => {
  it("ändert nur, was sich ändert", () => {
    const sel = new Set(["a", "b"]);
    expect(bulkTargets(items, sel, "publish").map((p) => p.id)).toEqual(["b"]);
    expect(bulkTargets(items, sel, "unpublish").map((p) => p.id)).toEqual(["a"]);
    expect(bulkTargets(items, sel, "delete").map((p) => p.id)).toEqual(["a", "b"]);
    expect(bulkTargets(items, new Set(), "delete")).toEqual([]);
  });
  it("Rückmeldung", () => {
    expect(bulkMessage("publish", 3, 0)).toBe("3 Produkte sind jetzt im Shop.");
    expect(bulkMessage("unpublish", 1, 0)).toBe("1 Produkt ist jetzt Entwurf.");
    expect(bulkMessage("delete", 2, 1)).toBe(
      "2 Produkte gelöscht. 1 Produkt ging nicht, bitte einzeln versuchen.",
    );
    expect(bulkMessage("publish", 0, 0)).toBe("Nichts zu ändern.");
  });
});
