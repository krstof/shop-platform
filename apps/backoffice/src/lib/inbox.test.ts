import { describe, expect, it } from "vitest";
import { messageTitle, receivedAt, replyLink, type ContactMessage } from "./inbox.js";

const m: ContactMessage = {
  id: "1",
  name: "Kim Muster",
  email: "kim+tee@example.org",
  subject: "Frage zum Sencha",
  message: "Hallo,\nist der Sencha auch in 250 g da?",
  read: false,
  createdAt: "2026-11-15T13:05:00.000Z",
};

describe("Posteingang", () => {
  it("nimmt den Betreff oder sonst den Anfang der Nachricht", () => {
    expect(messageTitle(m)).toBe("Frage zum Sencha");
    expect(messageTitle({ subject: "", message: "Erste Zeile\nZweite" })).toBe("Erste Zeile");
    expect(messageTitle({ subject: " ", message: "x".repeat(80) })).toHaveLength(59);
  });

  it("baut den Antwort-Link mit Empfänger, Re: und Zitat", () => {
    const link = replyLink(m, "Teeladen");
    expect(link.startsWith("mailto:kim%2Btee%40example.org?subject=Re%3A%20Frage%20zum%20Sencha&body=")).toBe(
      true,
    );
    expect(decodeURIComponent(link.split("body=")[1] ?? "")).toContain("> ist der Sencha auch in 250 g da?");
    expect(decodeURIComponent(replyLink({ ...m, subject: "" }, "Teeladen"))).toContain(
      "subject=Deine Nachricht an Teeladen",
    );
  });

  it("zeigt heute, gestern oder das Datum in deutscher Zeit", () => {
    const now = new Date("2026-11-15T20:00:00Z");
    expect(receivedAt("2026-11-15T13:05:00Z", now)).toBe("heute 14:05");
    expect(receivedAt("2026-11-14T08:12:00Z", now)).toBe("gestern 09:12");
    expect(receivedAt("2026-11-12T17:30:00Z", now)).toBe("12.11.2026, 18:30");
  });
});
