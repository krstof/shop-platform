import { describe, expect, it } from "vitest";
import { centsToInput, formatEuro, parseEuro } from "./money.js";

describe("Preise im Backoffice", () => {
  it.each([
    ["8,90", 890],
    ["8.90", 890],
    ["8", 800],
    ["8,9", 890],
    ["  12,50 € ", 1250],
    ["1.234,50", 123450],
    ["0", 0],
  ])("liest „%s“ als %i Cent", (text, cents) => {
    expect(parseEuro(text)).toBe(cents);
  });

  it.each(["", "abc", "8,999", "-1", "1,2,3", "8,"])("lehnt „%s“ ab", (text) => {
    expect(parseEuro(text)).toBeUndefined();
  });

  it("zeigt Cent als Euro", () => {
    expect(formatEuro(890).replace(/\s/g, " ")).toBe("8,90 €");
    expect(centsToInput(1250)).toBe("12,50");
    expect(parseEuro(centsToInput(123456))).toBe(123456);
  });
});
