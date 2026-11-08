import { SCOPES } from "@shop/http";
import { describe, expect, it } from "vitest";
import {
  MERCHANT_SCOPES,
  OWNER_ONLY_SCOPES,
  PLATFORM_SCOPES,
  scopesForRole,
  STAFF_SCOPES,
  TOKEN_FORBIDDEN_SCOPES,
  TOKEN_SCOPES,
} from "./roles.js";

describe("Systemrollen (Sicherheit 5.3)", () => {
  it("jede Berechtigung ist bewusst eingeordnet: Mitarbeiter, nur Inhaber oder nur Betreiber", () => {
    const classified = [...STAFF_SCOPES, ...OWNER_ONLY_SCOPES, ...PLATFORM_SCOPES].sort();
    expect(classified).toEqual([...SCOPES].sort());
    // Keine Berechtigung steht in zwei Gruppen.
    expect(new Set(classified).size).toBe(classified.length);
  });

  it("die Inhaberin darf alles im Shop, aber nichts in der Platform-API", () => {
    const owner = scopesForRole("owner");
    expect([...owner].sort()).toEqual([...MERCHANT_SCOPES].sort());
    for (const s of PLATFORM_SCOPES) expect(owner.has(s)).toBe(false);
  });

  it("Mitarbeiter dürfen höchstens, was die Inhaberin darf, und nichts nur für Inhaber", () => {
    const owner = scopesForRole("owner");
    const staff = scopesForRole("staff");
    for (const s of staff) expect(owner.has(s)).toBe(true);
    for (const s of OWNER_ONLY_SCOPES) expect(staff.has(s)).toBe(false);
    for (const s of PLATFORM_SCOPES) expect(staff.has(s)).toBe(false);
  });

  it("unbekannte und eigene Rollen bekommen nichts (eigene Rollen erst ab Welle 5)", () => {
    expect(scopesForRole("custom").size).toBe(0);
    expect(scopesForRole("admin").size).toBe(0);
    expect(scopesForRole("").size).toBe(0);
    expect(scopesForRole("__proto__").size).toBe(0);
  });

  it("API-Token sehen und verwalten darf nur die Inhaberin, und kein Token kann es selbst", () => {
    expect(scopesForRole("owner").has("api_tokens:write")).toBe(true);
    expect(scopesForRole("staff").has("api_tokens:read")).toBe(false);
    expect(TOKEN_FORBIDDEN_SCOPES).toEqual(["api_tokens:read", "api_tokens:write"]);
    for (const s of [...TOKEN_FORBIDDEN_SCOPES, ...PLATFORM_SCOPES]) expect(TOKEN_SCOPES).not.toContain(s);
    // Alles andere, was ein Shop vergeben kann, darf ein Token tragen.
    expect([...TOKEN_SCOPES, ...TOKEN_FORBIDDEN_SCOPES].sort()).toEqual([...MERCHANT_SCOPES].sort());
  });
});
