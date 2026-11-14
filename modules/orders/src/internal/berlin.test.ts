import { describe, expect, it } from "vitest";
import { berlinDate, berlinDates, berlinMidnight } from "./orders.js";

describe("Tage in deutscher Zeit", () => {
  it("nimmt den deutschen Kalendertag, nicht den in UTC", () => {
    expect(berlinDate(new Date("2026-11-13T23:30:00Z"))).toBe("2026-11-14"); // Winterzeit, UTC+1
    expect(berlinDate(new Date("2026-07-13T22:30:00Z"))).toBe("2026-07-14"); // Sommerzeit, UTC+2
  });

  it("liefert die letzten Tage bis heute, älteste zuerst, auch über die Zeitumstellung", () => {
    expect(berlinDates(new Date("2026-11-14T10:00:00Z"), 3)).toEqual([
      "2026-11-12",
      "2026-11-13",
      "2026-11-14",
    ]);
    expect(berlinDates(new Date("2026-10-26T10:00:00Z"), 3)).toEqual([
      "2026-10-24",
      "2026-10-25",
      "2026-10-26",
    ]);
  });

  it("findet Mitternacht in Winter- und Sommerzeit", () => {
    expect(berlinMidnight("2026-11-14").toISOString()).toBe("2026-11-13T23:00:00.000Z");
    expect(berlinMidnight("2026-07-14").toISOString()).toBe("2026-07-13T22:00:00.000Z");
  });
});
