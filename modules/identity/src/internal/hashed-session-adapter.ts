// Sitzungs-Token nur als SHA-256-Hash in der Datenbank (Sicherheit 5.2, B-04).
//
// Better Auth speichert das Sitzungs-Token sonst im Klartext in `session.token`. Wer die Tabelle
// lesen könnte (Fehler, Backup, Abzug), hätte damit gültige Cookies aller Händler. Diese Hülle
// um den Datenbank-Adapter von Better Auth ersetzt das Token auf dem Weg in die Datenbank durch
// seinen Hash, in Bedingungen ebenso wie beim Anlegen. Auf dem Rückweg setzt sie das Token
// wieder ein, soweit es bekannt ist (aus der Anfrage); sonst bleibt nur der Hash sichtbar.
//
// Better Auth kennt dafür keine eigene Einstellung (geprüft für 1.7.14). Die Tests in
// `auth.db.test.ts` prüfen, dass in der Tabelle nie ein Klartext-Token steht.
import { createHash } from "node:crypto";
import type { DBAdapter, Where } from "better-auth";

const SESSION_MODEL = "session";
const TOKEN_FIELD = "token";

/** Hash im Eingabeformat von PostgreSQL für `bytea` (`\x` und Hex). */
export function sessionTokenHash(token: string): string {
  return `\\x${createHash("sha256").update(token, "utf8").digest("hex")}`;
}

type Row = Record<string, unknown>;

function hashWhere(where: readonly Where[] | undefined, known: Map<string, string>): Where[] | undefined {
  if (where === undefined) return undefined;
  return where.map((w) => {
    if (w.field !== TOKEN_FIELD) return w;
    const op = w.operator ?? "eq";
    if ((op === "eq" || op === "ne") && typeof w.value === "string") {
      const h = sessionTokenHash(w.value);
      known.set(h, w.value);
      return { ...w, value: h };
    }
    if ((op === "in" || op === "not_in") && Array.isArray(w.value)) {
      const hashes = (w.value as unknown[]).map((v) => {
        const h = sessionTokenHash(String(v));
        known.set(h, String(v));
        return h;
      });
      return { ...w, value: hashes };
    }
    // Andere Vergleiche (enthält, beginnt mit ...) wären mit Hashes sinnlos und kämen einem
    // Durchsuchen der Token gleich. Better Auth nutzt sie nicht; vorsichtshalber verboten.
    throw new Error("Sitzungs-Token darf nur auf Gleichheit geprüft werden");
  });
}

function restore<T>(row: T, known: Map<string, string>): T {
  if (row === null || typeof row !== "object") return row;
  const r = row as Row;
  const value = r[TOKEN_FIELD];
  if (value === undefined) return row;
  const asHash = Buffer.isBuffer(value) ? `\\x${value.toString("hex")}` : String(value);
  // Unbekanntes Token: der Hash bleibt stehen (als Hex), das Klartext-Token ist nicht rekonstruierbar.
  return { ...r, [TOKEN_FIELD]: known.get(asHash) ?? asHash } as T;
}

function wrap<A extends Omit<DBAdapter, "transaction">>(inner: A): A {
  return {
    ...inner,
    async create(args) {
      if (args.model !== SESSION_MODEL) return inner.create(args);
      const known = new Map<string, string>();
      const data = { ...(args.data as Row) };
      if (typeof data[TOKEN_FIELD] === "string") {
        const h = sessionTokenHash(data[TOKEN_FIELD]);
        known.set(h, data[TOKEN_FIELD]);
        data[TOKEN_FIELD] = h;
      }
      return restore(await inner.create({ ...args, data: data as typeof args.data }), known);
    },
    async findOne(args) {
      if (args.model !== SESSION_MODEL) return inner.findOne(args);
      const known = new Map<string, string>();
      const where = hashWhere(args.where, known) ?? [];
      return restore(await inner.findOne({ ...args, where }), known);
    },
    async findMany(args) {
      if (args.model !== SESSION_MODEL) return inner.findMany(args);
      const known = new Map<string, string>();
      const where = hashWhere(args.where, known);
      const rows = await inner.findMany({ ...args, ...(where === undefined ? {} : { where }) });
      return rows.map((row) => restore(row, known));
    },
    async count(args) {
      if (args.model !== SESSION_MODEL) return inner.count(args);
      const where = hashWhere(args.where, new Map());
      return inner.count({ ...args, ...(where === undefined ? {} : { where }) });
    },
    async update(args) {
      if (args.model !== SESSION_MODEL) return inner.update(args);
      if (TOKEN_FIELD in (args.update as Row)) throw new Error("Sitzungs-Token ist unveränderlich");
      const known = new Map<string, string>();
      const where = hashWhere(args.where, known) ?? [];
      return restore(await inner.update({ ...args, where }), known);
    },
    async updateMany(args) {
      if (args.model !== SESSION_MODEL) return inner.updateMany(args);
      if (TOKEN_FIELD in (args.update as Row)) throw new Error("Sitzungs-Token ist unveränderlich");
      return inner.updateMany({ ...args, where: hashWhere(args.where, new Map()) ?? [] });
    },
    async delete(args) {
      if (args.model !== SESSION_MODEL) return inner.delete(args);
      return inner.delete({ ...args, where: hashWhere(args.where, new Map()) ?? [] });
    },
    async deleteMany(args) {
      if (args.model !== SESSION_MODEL) return inner.deleteMany(args);
      return inner.deleteMany({ ...args, where: hashWhere(args.where, new Map()) ?? [] });
    },
  } as A;
}

/** Hüllt einen Adapter samt seiner Transaktionen ein. */
export function withHashedSessionTokens(inner: DBAdapter): DBAdapter {
  const outer = wrap(inner) as DBAdapter;
  return {
    ...outer,
    transaction: (callback) => inner.transaction((trx) => callback(wrap(trx))),
  };
}
