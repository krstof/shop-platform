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

export const catalogEvents = [manufacturerCreated, manufacturerUpdated] as const;
