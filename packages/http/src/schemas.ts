// Gemeinsame Schemas für Ein- und Ausgaben (Architektur 4.8 und 4.9).
import { z } from "zod";

/** ID im Pfad: UUID (in der Plattform immer UUIDv7). Andere Werte ergeben 422, nie eine Datenbankabfrage. */
export const idParam = z.uuid().meta({ description: "UUID des Datensatzes." });

// Steuerzeichen und einzelne Ersatzzeichen (\p{Cs}), die in Eingaben nichts verloren haben.
// eslint-disable-next-line no-control-regex -- genau diese Zeichen sollen abgelehnt werden
const SINGLE_LINE_FORBIDDEN = /[\u0000-\u001f\u007f]|\p{Cs}/u;
// eslint-disable-next-line no-control-regex -- wie oben, aber Tabulator und Zeilenumbrüche erlaubt
const MULTI_LINE_FORBIDDEN = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]|\p{Cs}/u;

/**
 * Einzeiliger Text für Eingaben (Sicherheit 5.4): Leerraum am Rand entfernt, mindestens ein Zeichen,
 * Höchstlänge Pflicht, keine Steuerzeichen (auch keine Zeilenumbrüche, Schutz vor eingeschleusten
 * Kopfzeilen in E-Mails) und keine einzelnen Ersatzzeichen.
 */
export function singleLineText(max: number) {
  return z
    .string()
    .trim()
    .min(1)
    .max(max)
    .refine((v) => !SINGLE_LINE_FORBIDDEN.test(v), "Steuerzeichen sind nicht erlaubt.");
}

/** Mehrzeiliger Text: wie singleLineText, aber Zeilenumbruch und Tabulator erlaubt. */
export function multiLineText(max: number) {
  return z
    .string()
    .trim()
    .min(1)
    .max(max)
    .refine((v) => !MULTI_LINE_FORBIDDEN.test(v), "Steuerzeichen sind nicht erlaubt.");
}

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
