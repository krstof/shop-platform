// Gemeinsame Schemas für Ein- und Ausgaben (Architektur 4.8 und 4.9).
import { z } from "zod";

/** ID im Pfad: UUID (in der Plattform immer UUIDv7). Andere Werte ergeben 422, nie eine Datenbankabfrage. */
export const idParam = z.uuid().meta({ description: "UUID des Datensatzes." });

/** Zeitpunkt in der Ausgabe: ISO 8601 in UTC. */
export const timestamp = z.iso.datetime({ offset: false });

/** Fehlerantwort nach RFC 9457 (Problem Details), so wie toProblemDetails im Kernel sie baut. */
export const problemSchema = z
  .object({
    type: z.string(),
    title: z.string(),
    status: z.number().int(),
    code: z.string().meta({ description: "Feste, maschinenlesbare Kennung des Fehlers." }),
    detail: z.string().optional(),
    errors: z
      .array(
        z.object({
          path: z.string().meta({ description: "JSON Pointer auf das Feld, z. B. /body/name." }),
          code: z.string(),
          message: z.string(),
        }),
      )
      .optional(),
    requestId: z.string(),
  })
  .meta({ id: "Problem", description: "Fehler im Format Problem Details (RFC 9457)." });
