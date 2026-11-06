import { createHash } from "node:crypto";
import type { DBAdapter } from "better-auth";
import { describe, expect, it } from "vitest";
import { sessionTokenHash, withHashedSessionTokens } from "./hashed-session-adapter.js";

/** Einfacher Speicher, der nur Gleichheit und `in` kann, wie ein Datenbank-Adapter. */
function fakeAdapter(): { adapter: DBAdapter; rows: Record<string, unknown>[] } {
  const rows: Record<string, unknown>[] = [];
  const match = (
    row: Record<string, unknown>,
    where: { field: string; value: unknown; operator?: string }[] = [],
  ) =>
    where.every((w) =>
      w.operator === "in" ? (w.value as unknown[]).includes(row[w.field]) : row[w.field] === w.value,
    );
  const adapter = {
    id: "fake",
    create: async ({ data }: { data: Record<string, unknown> }) => {
      const row = { id: String(rows.length + 1), ...data };
      rows.push(row);
      return { ...row };
    },
    findOne: async ({ where }: { where: never[] }) => rows.find((r) => match(r, where)) ?? null,
    findMany: async ({ where }: { where?: never[] }) => rows.filter((r) => match(r, where)),
    count: async ({ where }: { where?: never[] }) => rows.filter((r) => match(r, where)).length,
    update: async ({ where, update }: { where: never[]; update: Record<string, unknown> }) => {
      const r = rows.find((x) => match(x, where));
      if (r === undefined) return null;
      Object.assign(r, update);
      return { ...r };
    },
    updateMany: async () => 0,
    delete: async ({ where }: { where: never[] }) => {
      const i = rows.findIndex((r) => match(r, where));
      if (i >= 0) rows.splice(i, 1);
    },
    deleteMany: async () => 0,
    transaction: async (cb: (trx: unknown) => Promise<unknown>) => cb(adapter),
  };
  return { adapter: adapter as unknown as DBAdapter, rows };
}

describe("Sitzungs-Token nur als Hash (Sicherheit 5.2)", () => {
  it("rechnet SHA-256 im bytea-Eingabeformat", () => {
    expect(sessionTokenHash("abc")).toBe(`\\x${createHash("sha256").update("abc").digest("hex")}`);
  });

  it("speichert den Hash, gibt aber das Token zurück", async () => {
    const { adapter, rows } = fakeAdapter();
    const a = withHashedSessionTokens(adapter);
    const created = await a.create<{ token: string; userId: string }>({
      model: "session",
      data: { token: "geheim-123", userId: "u1" },
    });
    expect(created.token).toBe("geheim-123");
    expect(rows[0]?.["token"]).toBe(sessionTokenHash("geheim-123"));
    expect(JSON.stringify(rows)).not.toContain("geheim-123");
  });

  it("sucht, zählt und löscht über den Hash", async () => {
    const { adapter, rows } = fakeAdapter();
    const a = withHashedSessionTokens(adapter);
    await a.create({ model: "session", data: { token: "t1" } });
    await a.create({ model: "session", data: { token: "t2" } });
    const one = await a.findOne<{ token: string }>({
      model: "session",
      where: [{ field: "token", value: "t1" }],
    });
    expect(one?.token).toBe("t1");
    const many = await a.findMany<{ token: string }>({
      model: "session",
      where: [{ field: "token", operator: "in", value: ["t1", "t2"] }],
    });
    expect(many.map((s) => s.token).sort()).toEqual(["t1", "t2"]);
    expect(await a.count({ model: "session", where: [{ field: "token", value: "t2" }] })).toBe(1);
    await a.delete({ model: "session", where: [{ field: "token", value: "t1" }] });
    expect(rows).toHaveLength(1);
  });

  it("gilt auch innerhalb von Transaktionen", async () => {
    const { adapter, rows } = fakeAdapter();
    await withHashedSessionTokens(adapter).transaction(async (trx) => {
      await trx.create({ model: "session", data: { token: "in-trx" } });
    });
    expect(rows[0]?.["token"]).toBe(sessionTokenHash("in-trx"));
  });

  it("verbietet Teilsuchen im Token und das Ändern des Tokens", async () => {
    const a = withHashedSessionTokens(fakeAdapter().adapter);
    await expect(
      a.findMany({ model: "session", where: [{ field: "token", operator: "starts_with", value: "t" }] }),
    ).rejects.toThrow();
    await expect(
      a.update({ model: "session", where: [{ field: "id", value: "1" }], update: { token: "neu" } }),
    ).rejects.toThrow();
  });

  it("lässt andere Tabellen unverändert", async () => {
    const { adapter, rows } = fakeAdapter();
    await withHashedSessionTokens(adapter).create({ model: "verification", data: { token: "x" } });
    expect(rows[0]?.["token"]).toBe("x");
  });
});
