// Ereignisse des Moduls catalog (ADR-007). Name, Version und Zod-Schema an einer Stelle.
// Andere Module hören darauf über die Fassade (index.ts), nie über interne Dateien.
// Vereinbarung (kernel/events/event.ts): `id` nennt das Objekt, `changes` ist { feld: [alt, neu] }.
import { defineEvent } from "@shop/kernel";
import { z } from "zod";

const value = z.string().nullable();

export const manufacturerCreated = defineEvent(
  "catalog.manufacturer.created.v1",
  z.strictObject({ id: z.uuid(), name: z.string() }),
);

/** Nur die Felder, die sich wirklich geändert haben, mit altem und neuem Wert (Spaltennamen). */
export const manufacturerUpdated = defineEvent(
  "catalog.manufacturer.updated.v1",
  z.strictObject({ id: z.uuid(), changes: z.record(z.string(), z.tuple([value, value])) }),
);

// Produkte und Kategorien (M2). `changes` nennt Felder der API (name, slug, price …), Werte als Text.
export const productCreated = defineEvent(
  "catalog.product.created.v1",
  z.strictObject({ id: z.uuid(), name: z.string() }),
);

export const productUpdated = defineEvent(
  "catalog.product.updated.v1",
  z.strictObject({ id: z.uuid(), changes: z.record(z.string(), z.tuple([value, value])) }),
);

export const categoryCreated = defineEvent(
  "catalog.category.created.v1",
  z.strictObject({ id: z.uuid(), name: z.string() }),
);

export const categoryUpdated = defineEvent(
  "catalog.category.updated.v1",
  z.strictObject({ id: z.uuid(), changes: z.record(z.string(), z.tuple([value, value])) }),
);

export const catalogEvents = [
  manufacturerCreated,
  manufacturerUpdated,
  productCreated,
  productUpdated,
  categoryCreated,
  categoryUpdated,
] as const;

/** Unterschiede zweier Stände als { feld: [alt, neu] }; Zahlen werden zu Text. */
export function diff(
  before: Readonly<Record<string, string | number | null>>,
  after: Readonly<Record<string, string | number | null>>,
): Record<string, [string | null, string | null]> {
  const out: Record<string, [string | null, string | null]> = {};
  for (const key of Object.keys(after)) {
    const a = before[key] ?? null;
    const b = after[key] ?? null;
    if (a !== b) out[key] = [a === null ? null : String(a), b === null ? null : String(b)];
  }
  return out;
}
