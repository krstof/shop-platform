import { describe, expect, it } from "vitest";
import { sortierung } from "./sortierung.js";

describe("sortierung", () => {
  it("nimmt bekannte Werte, sonst standard", () => {
    expect(sortierung("price-asc")).toBe("price-asc");
    expect(sortierung("name")).toBe("name");
    expect(sortierung(null)).toBe("standard");
    expect(sortierung("billig")).toBe("standard");
    expect(sortierung("<script>")).toBe("standard");
  });
});
