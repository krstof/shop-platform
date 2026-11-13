// Shop-Editor Teil 1 (12./13.11.2026): Aussehen eines Shops in Admin- und Storefront-API.
// Der Händler ändert einen Entwurf (Farbe, Schrift, Logo); erst „Veröffentlichen“ macht ihn im Shop
// sichtbar. Die Storefront liest nur den veröffentlichten Stand.
import { defineEndpoint, singleLineText, timestamp, type Endpoint } from "@shop/http";
import {
  getContext,
  NotFoundError,
  PreconditionFailedError,
  ValidationError,
  withTenantTransaction,
  type Database,
} from "@shop/kernel";
import { z } from "zod";
import type { DB } from "../db.generated.js";
import {
  darker,
  FONTS,
  MIN_CONTRAST,
  normalizeHex,
  readableWithWhite,
  sameSettings,
  type DesignSettings,
} from "../internal/design.js";
import {
  lockInstallation,
  readInstallation,
  writeInstallation,
  type Installation,
} from "../internal/installation.js";

/** Ein fertiges Bild (Modul media). */
export interface DesignImage {
  readonly id: string;
  readonly url: string;
  readonly thumbnailUrl: string;
  readonly width: number;
  readonly height: number;
}

export type ImageRejection = "unsupported_format" | "too_large" | "too_small" | "unreadable";

/** Was das Aussehen von Bildern braucht. Erfüllt das Modul media, zusammengesteckt in apps/api. */
export interface DesignImages {
  prepare(
    data: Uint8Array,
    filename?: string,
  ): Promise<
    | { readonly ok: true; save(): Promise<DesignImage> }
    | { readonly ok: false; readonly reason: ImageRejection }
  >;
  get(ids: readonly string[]): Promise<Map<string, DesignImage>>;
  /** Löscht Bilder samt Dateien. Erst nach der eigenen Transaktion aufrufen. */
  remove(ids: readonly string[]): Promise<void>;
}

const MAX_LOGO_BYTES = 8 * 1024 * 1024;
const MAX_BASE64_CHARS = Math.ceil(MAX_LOGO_BYTES / 3) * 4;
const LOGO_BODY_LIMIT = 12 * 1024 * 1024;

const REJECTION_TEXT: Record<ImageRejection, string> = {
  unsupported_format: "Bitte das Logo als PNG, JPEG oder WebP hochladen.",
  too_large: "Das Logo ist zu groß (höchstens 8 MB).",
  too_small: "Das Logo ist zu klein (mindestens 32 × 32 Pixel).",
  unreadable: "Die Datei lässt sich nicht lesen. Ist sie beschädigt?",
};

const TOO_LIGHT =
  "Diese Farbe ist zu hell: Weiße Schrift auf Knöpfen wäre schlecht lesbar. Bitte eine dunklere Farbe wählen.";

const imageSchema = z
  .object({
    id: z.uuid(),
    url: z.url(),
    thumbnailUrl: z.url(),
    width: z.number().int(),
    height: z.number().int(),
  })
  .meta({ id: "DesignImage", description: "Bild, ausgeliefert über media.<Domain> (WebP)." });

const fontSchema = z.enum(FONTS).meta({
  description:
    "Schriftart (nur Systemschriften): `klassisch` (Überschriften mit Serifen), `modern` (alles " +
    "ohne Serifen), `freundlich` (abgerundet).",
});

const accentSchema = z
  .string()
  .regex(/^#[0-9a-fA-F]{6}$/)
  .meta({ description: "Hauptfarbe als Hex, etwa `#3f6b4a`. Für Knöpfe, Links und Markierungen." });

const designViewSchema = z
  .object({ accentColor: z.string(), font: fontSchema, logo: imageSchema.nullable() })
  .meta({ id: "Design", description: "Ein Stand des Aussehens: Hauptfarbe, Schrift, Logo." });

const designStateSchema = z
  .object({
    draft: designViewSchema.meta({ description: "Entwurf, den der Editor bearbeitet." }),
    published: designViewSchema.meta({ description: "Was der Shop gerade zeigt." }),
    hasUnpublishedChanges: z.boolean(),
    publishedAt: timestamp.nullable(),
    version: z.number().int().meta({ description: "Für If-Match beim Speichern des Entwurfs." }),
  })
  .meta({ id: "DesignState", description: "Aussehen des Shops mit Entwurf und veröffentlichtem Stand." });

const draftInput = z.strictObject({
  accentColor: accentSchema,
  font: fontSchema,
  logoImageId: z
    .uuid()
    .nullable()
    .meta({ description: "Bild-ID des Logos (aus dem Hochladen) oder `null` für „kein Logo“." }),
});

const logoInput = z.strictObject({
  data: z
    .base64()
    .max(MAX_BASE64_CHARS)
    .meta({ description: "Logo als Base64 (PNG, JPEG oder WebP, höchstens 8 MB, kein SVG)." }),
  filename: singleLineText(200).optional().meta({ description: "Ursprünglicher Dateiname, nur zur Info." }),
});

const storeDesignSchema = z
  .object({
    accentColor: z.string(),
    accentDarkColor: z.string().meta({ description: "Dunklere Fassung für Links und „Maus darüber“." }),
    font: fontSchema,
    logo: z.object({ url: z.url(), width: z.number().int(), height: z.number().int() }).nullable(),
  })
  .meta({ id: "StoreDesign", description: "Veröffentlichtes Aussehen eines Shops." });

/** Kleines gültiges PNG (32 × 32 Pixel) als Beispiel für Dokumentation und Tests. */
const EXAMPLE_PNG =
  "iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAMAAABEpIrGAAAAA1BMVEV6mluJCzqwAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAEkl" +
  "EQVQ4y2NgGAWjYBSMAuwAAAQgAAFWu83mAAAAAElFTkSuQmCC";

export interface DesignEndpointDependencies {
  readonly db: Database<DB>;
  readonly images: DesignImages;
}

export function designEndpoints({ db, images }: DesignEndpointDependencies): Endpoint[] {
  const tenant = () => getContext()?.tenantId ?? "";

  async function toState(i: Installation): Promise<z.infer<typeof designStateSchema>> {
    const ids = [i.draft.logoImageId, i.published.logoImageId].filter((x): x is string => x !== null);
    const found = await images.get(ids);
    const view = (s: DesignSettings) => ({
      accentColor: s.accentColor,
      font: s.font,
      logo: s.logoImageId === null ? null : (found.get(s.logoImageId) ?? null),
    });
    return {
      draft: view(i.draft),
      published: view(i.published),
      hasUnpublishedChanges: !sameSettings(i.draft, i.published),
      publishedAt: i.publishedAt?.toISOString() ?? null,
      version: i.version,
    };
  }

  /** Logos, die weder im Entwurf noch veröffentlicht vorkommen, samt Dateien löschen. */
  async function dropUnused(before: Installation, after: Installation): Promise<void> {
    const keep = new Set([after.draft.logoImageId, after.published.logoImageId]);
    const unused = [before.draft.logoImageId, before.published.logoImageId].filter(
      (id): id is string => id !== null && !keep.has(id),
    );
    if (unused.length > 0) await images.remove([...new Set(unused)]);
  }

  /** Ändert den Zustand unter Sperre und räumt danach nicht mehr benutzte Logos weg. */
  async function change(
    fn: (current: Installation) => Promise<Parameters<typeof writeInstallation>[1] | undefined>,
  ): Promise<z.infer<typeof designStateSchema>> {
    const { before, after } = await withTenantTransaction(db, async (trx) => {
      const current = await lockInstallation(trx, tenant());
      const update = await fn(current);
      return {
        before: current,
        after: update === undefined ? current : await writeInstallation(trx, update),
      };
    });
    await dropUnused(before, after);
    return toState(after);
  }

  const access = {
    read: { scopes: ["settings:read"] as const },
    write: { scopes: ["settings:write"] as const },
  };

  const get = defineEndpoint({
    api: "admin",
    method: "GET",
    path: "/design",
    operationId: "getDesign",
    summary: "Aussehen lesen",
    description: "Entwurf und veröffentlichten Stand des Aussehens (Hauptfarbe, Schrift, Logo).",
    tags: ["Aussehen"],
    access: access.read,
    response: { status: 200, description: "Das Aussehen.", schema: designStateSchema },
    handler: async () => toState(await withTenantTransaction(db, (trx) => readInstallation(trx))),
  });

  const saveDraft = defineEndpoint({
    api: "admin",
    method: "PUT",
    path: "/design/draft",
    operationId: "saveDesignDraft",
    summary: "Entwurf speichern",
    description:
      "Speichert den Entwurf. Im Shop ändert sich erst nach „Veröffentlichen“ etwas. Die Hauptfarbe " +
      `muss mit weißer Schrift mindestens ${MIN_CONTRAST} : 1 Kontrast haben (sonst 422). Verlangt ` +
      "die Version als If-Match; hat inzwischen jemand anders geändert, kommt 412.",
    tags: ["Aussehen"],
    access: access.write,
    body: draftInput,
    bodyExample: { accentColor: "#1f5f8b", font: "modern", logoImageId: null },
    ifMatch: "required",
    response: { status: 200, description: "Das Aussehen mit neuem Entwurf.", schema: designStateSchema },
    problems: [412, 428],
    handler: async ({ body, ifMatch }) => {
      const accent = normalizeHex(body.accentColor) ?? "";
      if (!readableWithWhite(accent))
        throw new ValidationError({
          detail: TOO_LIGHT,
          errors: [{ path: "/accentColor", code: "low_contrast", message: TOO_LIGHT }],
        });
      return change(async (current) => {
        if (current.version !== ifMatch) throw new PreconditionFailedError();
        const logo = body.logoImageId;
        // Nur ein Logo, das es in diesem Shop gibt (fremde oder erfundene IDs fehlen in der Antwort).
        if (logo !== null && !(await images.get([logo])).has(logo))
          throw new ValidationError({
            detail: "Dieses Logo gibt es nicht. Bitte neu hochladen.",
            errors: [{ path: "/logoImageId", code: "unknown_image", message: "Unbekanntes Bild." }],
          });
        return { draft: { accentColor: accent, font: body.font, logoImageId: logo } };
      });
    },
  });

  const uploadLogo = defineEndpoint({
    api: "admin",
    method: "POST",
    path: "/design/logo",
    operationId: "uploadDesignLogo",
    summary: "Logo hochladen",
    description:
      "Lädt ein Logo hoch (PNG, JPEG oder WebP als Base64, höchstens 8 MB) und setzt es in den " +
      "Entwurf. Transparenz bleibt erhalten. Ein vorheriges Logo des Entwurfs wird gelöscht, wenn " +
      "es nicht veröffentlicht ist.",
    tags: ["Aussehen"],
    access: access.write,
    body: logoInput,
    bodyExample: { data: EXAMPLE_PNG, filename: "logo.png" },
    bodyLimit: LOGO_BODY_LIMIT,
    response: {
      status: 201,
      description: "Das Aussehen mit neuem Logo im Entwurf.",
      schema: designStateSchema,
    },
    problems: [413],
    handler: async ({ body }) => {
      // Rechnen vor der Transaktion: Das kann eine Sekunde dauern und soll nichts sperren.
      const prepared = await images.prepare(Buffer.from(body.data, "base64"), body.filename);
      if (!prepared.ok)
        throw new ValidationError({
          detail: REJECTION_TEXT[prepared.reason],
          errors: [{ path: "/data", code: prepared.reason, message: REJECTION_TEXT[prepared.reason] }],
        });
      const image = await prepared.save();
      return change(async (current) => ({ draft: { ...current.draft, logoImageId: image.id } }));
    },
  });

  const publish = defineEndpoint({
    api: "admin",
    method: "POST",
    path: "/design/publish",
    operationId: "publishDesign",
    summary: "Entwurf veröffentlichen",
    description: "Macht den gespeicherten Entwurf im Shop sichtbar.",
    tags: ["Aussehen"],
    access: access.write,
    response: { status: 200, description: "Das Aussehen, jetzt veröffentlicht.", schema: designStateSchema },
    handler: async () => change(async (current) => ({ published: current.draft, publishedAt: new Date() })),
  });

  const discard = defineEndpoint({
    api: "admin",
    method: "POST",
    path: "/design/discard",
    operationId: "discardDesignDraft",
    summary: "Entwurf verwerfen",
    description: "Setzt den Entwurf auf den veröffentlichten Stand zurück.",
    tags: ["Aussehen"],
    access: access.write,
    response: { status: 200, description: "Das Aussehen ohne Änderungen.", schema: designStateSchema },
    handler: async () =>
      change(async (current) =>
        sameSettings(current.draft, current.published) ? undefined : { draft: current.published },
      ),
  });

  const store = defineEndpoint({
    api: "store",
    method: "GET",
    path: "/shops/{shopHandle}/design",
    operationId: "getStoreDesign",
    summary: "Aussehen des Shops",
    description: "Veröffentlichte Hauptfarbe, Schrift und Logo. Unbekannte oder gesperrte Shops ergeben 404.",
    tags: ["Storefront"],
    access: { public: true, reason: "Jeder Besucher sieht das Aussehen des Shops, den er aufruft." },
    params: z.strictObject({
      shopHandle: z
        .string()
        .regex(/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/)
        .meta({ description: "Kürzel des Shops, etwa `teeladen`." }),
    }),
    response: { status: 200, description: "Das Aussehen.", schema: storeDesignSchema },
    problems: [404],
    handler: async () => {
      if (getContext()?.tenantId === undefined) throw new NotFoundError();
      const { published } = await withTenantTransaction(db, (trx) => readInstallation(trx));
      const logo =
        published.logoImageId === null
          ? undefined
          : (await images.get([published.logoImageId])).get(published.logoImageId);
      return {
        accentColor: published.accentColor,
        accentDarkColor: darker(published.accentColor),
        font: published.font,
        logo: logo === undefined ? null : { url: logo.url, width: logo.width, height: logo.height },
      };
    },
  });

  return [get, saveDraft, uploadLogo, publish, discard, store];
}
