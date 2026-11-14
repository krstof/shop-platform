import { describe, expect, it } from "vitest";
import { looksLikeEmail, roleLabel, sortMembers, statusLabel, type Member } from "./team.js";

const m = (email: string, role: Member["role"], status: Member["status"]): Member => ({
  id: email,
  userId: email,
  email,
  name: null,
  role,
  status,
  createdAt: "2026-11-14T10:00:00Z",
});

describe("Team", () => {
  it("Texte für Rolle und Status", () => {
    expect(roleLabel("owner")).toBe("Inhaber:in");
    expect(roleLabel("staff")).toBe("Mitarbeiter:in");
    expect(statusLabel("invited")).toEqual({ text: "Eingeladen", tone: "amber" });
    expect(statusLabel("active").text).toBe("Aktiv");
  });
  it("Inhaber:in oben, dann aktive, dann eingeladene", () => {
    const sorted = sortMembers([
      m("zoe@x.de", "staff", "invited"),
      m("bob@x.de", "staff", "active"),
      m("chefin@x.de", "owner", "active"),
      m("anna@x.de", "staff", "invited"),
    ]);
    expect(sorted.map((x) => x.email)).toEqual(["chefin@x.de", "bob@x.de", "anna@x.de", "zoe@x.de"]);
  });
  it("prüft E-Mail grob", () => {
    expect(looksLikeEmail(" kim@example.org ")).toBe(true);
    expect(looksLikeEmail("kim@example")).toBe(false);
    expect(looksLikeEmail("kim example.org")).toBe(false);
  });
});
