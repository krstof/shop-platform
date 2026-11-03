// Listen mit Cursor (Architektur 4.7, Q-07): `limit` (Standard 25, höchstens 100) und `cursor`.
// Der Cursor ist eine undurchsichtige Lesemarke: Base64url von JSON mit den Sortierwerten des
// letzten Eintrags. Er enthält keine Geheimnisse und keinen Mandanten; was er lesen darf, entscheidet
// weiterhin die RLS. Ein kaputter oder veränderter Cursor ergibt 422, nie 500.
import { ValidationError, type Locale } from "@shop/kernel";
import { z } from "zod";

export const DEFAULT_LIMIT = 25;
export const MAX_LIMIT = 100;
const MAX_CURSOR_LENGTH = 512;

export const limitSchema = z.coerce
  .number()
  .int()
  .min(1)
  .max(MAX_LIMIT)
  .default(DEFAULT_LIMIT)
  .meta({
    description: `Einträge pro Seite, 1 bis ${MAX_LIMIT} (Standard ${DEFAULT_LIMIT}).`,
  });

export const cursorSchema = z
  .string()
  .min(1)
  .max(MAX_CURSOR_LENGTH)
  .regex(/^[A-Za-z0-9_-]+$/)
  .optional()
  .meta({ description: "Lesemarke aus `page.nextCursor` der vorigen Seite." });

/** Abfrageparameter einer Liste: `limit`, `cursor` und eigene Filter. */
export function listQuery<S extends z.ZodRawShape = Record<never, never>>(filters?: S) {
  return z.strictObject({ limit: limitSchema, cursor: cursorSchema, ...(filters ?? ({} as S)) });
}

/** Antwort einer Liste. Ausgabeschemas entfernen unbekannte Felder statt sie mitzuschicken. */
export function pageOf<T extends z.ZodType>(item: T) {
  return z.object({
    data: z.array(item).max(MAX_LIMIT),
    page: z.object({
      nextCursor: z.string().nullable(),
      hasMore: z.boolean(),
    }),
  });
}

export function encodeCursor(values: Readonly<Record<string, string | number>>): string {
  return Buffer.from(JSON.stringify(values), "utf8").toString("base64url");
}

const INVALID: Readonly<Record<Locale, string>> = {
  de: "Die Lesemarke ist ungültig. Bitte die Liste von vorn laden.",
  en: "The cursor is invalid. Please load the list from the start.",
};

/** Liest einen Cursor und prüft ihn gegen ein Schema. Alles Unerwartete ergibt einen 422er. */
export function decodeCursor<S extends z.ZodType>(
  cursor: string,
  schema: S,
  locale: Locale = "de",
): z.output<S> {
  let raw: unknown;
  try {
    raw = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
  } catch {
    raw = undefined;
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    throw new ValidationError({
      detail: INVALID[locale],
      errors: [{ path: "/query/cursor", code: "invalid_cursor", message: INVALID[locale] }],
    });
  }
  return parsed.data;
}

/**
 * Baut eine Seite aus `limit + 1` gelesenen Zeilen: Gibt es mehr als `limit`, gibt es eine
 * nächste Seite, und deren Cursor zeigt auf den letzten ausgelieferten Eintrag.
 */
export function toPage<Row, Item>(
  rows: readonly Row[],
  limit: number,
  cursorOf: (row: Row) => Readonly<Record<string, string | number>>,
  map: (row: Row) => Item,
): { data: Item[]; page: { nextCursor: string | null; hasMore: boolean } } {
  const hasMore = rows.length > limit;
  const visible = hasMore ? rows.slice(0, limit) : rows;
  const last = visible.at(-1);
  return {
    data: visible.map(map),
    page: { nextCursor: hasMore && last !== undefined ? encodeCursor(cursorOf(last)) : null, hasMore },
  };
}
