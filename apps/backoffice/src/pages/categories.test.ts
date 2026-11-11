import { describe, expect, it } from "vitest";
import { reorder } from "./categories.js";

const list = [
  { id: "a", position: 10 },
  { id: "b", position: 20 },
  { id: "c", position: 30 },
];

describe("reorder", () => {
  it("tauscht zwei Nachbarn und ändert nur deren Position", () => {
    expect(reorder(list, 1, -1)).toEqual([
      { id: "b", position: 10 },
      { id: "a", position: 20 },
    ]);
  });

  it("vergibt bei gleichen Positionen (z. B. alle 0) eine saubere Reihenfolge", () => {
    const same = list.map((c) => ({ ...c, position: 0 }));
    expect(reorder(same, 0, 1)).toEqual([
      { id: "b", position: 10 },
      { id: "a", position: 20 },
      { id: "c", position: 30 },
    ]);
  });

  it("macht nichts am Rand", () => {
    expect(reorder(list, 0, -1)).toEqual([]);
    expect(reorder(list, 2, 1)).toEqual([]);
  });
});
