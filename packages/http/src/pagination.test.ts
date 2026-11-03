import { ValidationError } from "@shop/kernel";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { decodeCursor, encodeCursor, listQuery, toPage } from "./pagination.js";

const keySchema = z.strictObject({ id: z.uuid() });
const ID = "0192f1c4-7a1e-7c3b-8000-000000000001";

describe("Cursor-Listen (Q-07)", () => {
  it("limit: Standard 25, höchstens 100, Text aus der Adresse wird zur Zahl", () => {
    const q = listQuery();
    expect(q.parse({})).toEqual({ limit: 25 });
    expect(q.parse({ limit: "100" }).limit).toBe(100);
    expect(q.safeParse({ limit: "101" }).success).toBe(false);
    expect(q.safeParse({ limit: "0" }).success).toBe(false);
    expect(q.safeParse({ limit: "abc" }).success).toBe(false);
    expect(q.safeParse({ limit: "2.5" }).success).toBe(false);
  });

  it("lehnt unbekannte Abfrageparameter ab", () => {
    expect(listQuery().safeParse({ tenantId: ID }).success).toBe(false);
  });

  it("Cursor hin und zurück", () => {
    const c = encodeCursor({ id: ID });
    expect(c).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(decodeCursor(c, keySchema)).toEqual({ id: ID });
  });

  it.each([
    ["kein Base64-JSON", "%%%"],
    ["anderes Feld", encodeCursor({ name: "x" })],
    ["keine UUID", encodeCursor({ id: "1 OR 1=1" })],
    ["leeres JSON", Buffer.from("null").toString("base64url")],
  ])("kaputter Cursor (%s) ergibt 422 mit Feld /query/cursor", (_n, cursor) => {
    try {
      decodeCursor(cursor, keySchema, "en");
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(ValidationError);
      expect((e as ValidationError).errors?.[0]?.path).toBe("/query/cursor");
      expect((e as ValidationError).detail).toMatch(/^The cursor is invalid/);
    }
  });

  it("toPage: nächste Seite nur, wenn mehr Zeilen da sind als verlangt", () => {
    const rows = [{ id: "a" }, { id: "b" }, { id: "c" }];
    const full = toPage(
      rows,
      2,
      (r) => ({ id: r.id }),
      (r) => r.id,
    );
    expect(full.data).toEqual(["a", "b"]);
    expect(full.page.hasMore).toBe(true);
    expect(JSON.parse(Buffer.from(full.page.nextCursor ?? "", "base64url").toString())).toEqual({ id: "b" });
    const last = toPage(
      rows,
      3,
      (r) => ({ id: r.id }),
      (r) => r.id,
    );
    expect(last.page).toEqual({ nextCursor: null, hasMore: false });
    expect(
      toPage(
        [],
        25,
        () => ({}),
        (r) => r,
      ).page,
    ).toEqual({ nextCursor: null, hasMore: false });
  });
});
