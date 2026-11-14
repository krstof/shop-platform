// Shop-Editor Teil 1 und 2 (12./13.11.2026): Aussehen eines Shops in Admin- und Storefront-API.
// Der Händler ändert einen Entwurf (Farbe, Schrift, Logo, Startseite); erst „Veröffentlichen“ macht ihn im Shop
// sichtbar. Die Storefront liest nur den veröffentlichten Stand.
import { defineEndpoint, multiLineText, singleLineText, timestamp, type Endpoint } from "@shop/http";
import {
  getContext,
  NotFoundError,
  PreconditionFailedError,
  ValidationError,
  withTenantTransaction,
  type Database,
} from "@shop/kernel";
import { z } from "zod";
import { blocksSchema, blockImages, legacyBlocks, parseVideoUrl, type Block } from "../internal/blocks.js";
import type { DB } from "../db.generated.js";
import {
  darker,
  FONTS,
  imagesOf,
  isSafeLinkUrl,
  MAX_FEATURED,
  MAX_FOOTER_LINKS,
  MAX_FOOTER_TEXT,
  MAX_LINK_LABEL,
  MAX_LINK_URL,
  MAX_TAGLINE,
  MAX_HERO_TEXT,
  MAX_HERO_TITLE,
  MIN_CONTRAST,
  normalizeHex,
  readableWithWhite,
  sameSettings,
  type DesignSettings,
  type FooterSettings,
  type HomeSettings,
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

function rejectionText(reason: ImageRejection, what: "Das Logo" | "Das Bild"): string {
  switch (reason) {
    case "unsupported_format":
      return `Bitte ${what === "Das Logo" ? "das Logo" : "das Bild"} als PNG, JPEG oder WebP hochladen.`;
    case "too_large":
      return `${what} ist zu groß (höchstens 8 MB).`;
    case "too_small":
      return `${what} ist zu klein (mindestens 32 × 32 Pixel).`;
    case "unreadable":
      return "Die Datei lässt sich nicht lesen. Ist sie beschädigt?";
  }
}

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

const homeViewSchema = z
  .object({
    heroImage: imageSchema.nullable().meta({ description: "Großes Bild oben auf der Startseite." }),
    heroTitle: z.string().meta({ description: "Überschrift; leer heißt „Willkommen bei <Shopname>“." }),
    heroText: z.string().meta({ description: "Text unter der Überschrift; leer heißt Standardtext." }),
    featuredProductIds: z
      .array(z.uuid())
      .meta({ description: "Hervorgehobene Produkte in dieser Reihenfolge." }),
    showCategories: z
      .boolean()
      .meta({ description: "Kacheln mit den Kategorien auf der Startseite zeigen." }),
    showNew: z
      .boolean()
      .meta({ description: "Abschnitt „Neu im Shop“ mit den vier neuesten Produkten zeigen." }),
    blocks: blocksSchema
      .nullable()
      .meta({ description: "Bausteine in Reihenfolge (Baukasten); null = alte feste Reihenfolge." }),
    blockImages: z
      .array(imageSchema)
      .meta({ description: "Die Bilder, die die Bausteine benutzen (für Vorschaubilder im Editor)." }),
  })
  .meta({
    id: "DesignHome",
    description: "Startseite: Bild mit Überschrift und Text, Empfehlungen, Kategorien.",
  });

const footerLinkSchema = z
  .object({ label: z.string(), url: z.string() })
  .meta({ id: "DesignFooterLink", description: "Link im Fuß des Shops." });

const footerViewSchema = z
  .object({
    text: z.string().meta({ description: "Kurzer Text im Fuß; leer heißt Standardhinweis." }),
    links: z.array(footerLinkSchema),
  })
  .meta({ id: "DesignFooter", description: "Fußzeile: Text und Links." });

const designViewSchema = z
  .object({
    accentColor: z.string(),
    font: fontSchema,
    logo: imageSchema.nullable(),
    home: homeViewSchema,
    tagline: z.string().meta({ description: "Kurzer Text unter dem Logo; leer heißt keiner." }),
    footer: footerViewSchema,
  })
  .meta({ id: "Design", description: "Ein Stand des Aussehens: Hauptfarbe, Schrift, Logo, Startseite." });

const designStateSchema = z
  .object({
    draft: designViewSchema.meta({ description: "Entwurf, den der Editor bearbeitet." }),
    published: designViewSchema.meta({ description: "Was der Shop gerade zeigt." }),
    hasUnpublishedChanges: z.boolean(),
    publishedAt: timestamp.nullable(),
    version: z.number().int().meta({ description: "Für If-Match beim Speichern des Entwurfs." }),
  })
  .meta({ id: "DesignState", description: "Aussehen des Shops mit Entwurf und veröffentlichtem Stand." });

const homeInput = z
  .strictObject({
    heroImageId: z
      .uuid()
      .nullable()
      .meta({ description: "Bild-ID des großen Bildes (aus dem Hochladen) oder `null` für „kein Bild“." }),
    heroTitle: singleLineText(MAX_HERO_TITLE)
      .or(z.literal(""))
      .meta({ description: `Überschrift, höchstens ${MAX_HERO_TITLE} Zeichen; leer für den Standard.` }),
    heroText: multiLineText(MAX_HERO_TEXT)
      .or(z.literal(""))
      .meta({
        description: `Text unter der Überschrift, höchstens ${MAX_HERO_TEXT} Zeichen; leer für den Standard.`,
      }),
    featuredProductIds: z
      .array(z.uuid())
      .max(MAX_FEATURED)
      .refine((ids) => new Set(ids).size === ids.length, { message: "Jedes Produkt nur einmal." })
      .meta({ description: `Bis zu ${MAX_FEATURED} Produkt-IDs, in der gewünschten Reihenfolge.` }),
    showCategories: z.boolean(),
    showNew: z.boolean().optional().meta({ description: "Fehlt es, bleibt der bisherige Wert." }),
    blocks: blocksSchema
      .nullable()
      .optional()
      .meta({
        description:
          "Bausteine der Startseite in Reihenfolge: hero, featured, categories, new (je höchstens einmal) sowie " +
          "text, textImage, image, video (YouTube/Vimeo), map (Adresse) und spacer. Fehlt das Feld, bleiben sie.",
      }),
  })
  .meta({ id: "DesignHomeInput" });

const footerInput = z
  .strictObject({
    text: multiLineText(MAX_FOOTER_TEXT)
      .or(z.literal(""))
      .meta({ description: `Text im Fuß, höchstens ${MAX_FOOTER_TEXT} Zeichen; leer für den Standard.` }),
    links: z
      .array(
        z.strictObject({
          label: singleLineText(MAX_LINK_LABEL).meta({ description: "Beschriftung, etwa „Kontakt“." }),
          url: z
            .string()
            .trim()
            .max(MAX_LINK_URL)
            .refine(isSafeLinkUrl, "Bitte eine Adresse mit https://, mailto: oder tel: angeben.")
            .meta({ description: "Ziel: `https://…`, `mailto:…` oder `tel:…`." }),
        }),
      )
      .max(MAX_FOOTER_LINKS)
      .meta({ description: `Bis zu ${MAX_FOOTER_LINKS} Links in dieser Reihenfolge.` }),
  })
  .meta({ id: "DesignFooterInput" });

const draftInput = z.strictObject({
  accentColor: accentSchema,
  font: fontSchema,
  logoImageId: z
    .uuid()
    .nullable()
    .meta({ description: "Bild-ID des Logos (aus dem Hochladen) oder `null` für „kein Logo“." }),
  home: homeInput
    .optional()
    .meta({ description: "Startseite. Fehlt das Feld, bleibt die Startseite im Entwurf, wie sie ist." }),
  tagline: singleLineText(MAX_TAGLINE)
    .or(z.literal(""))
    .optional()
    .meta({
      description: `Text unter dem Logo, höchstens ${MAX_TAGLINE} Zeichen. Fehlt das Feld, bleibt er.`,
    }),
  footer: footerInput
    .optional()
    .meta({ description: "Fußzeile. Fehlt das Feld, bleibt sie im Entwurf, wie sie ist." }),
});

const logoInput = z.strictObject({
  data: z
    .base64()
    .max(MAX_BASE64_CHARS)
    .meta({ description: "Logo als Base64 (PNG, JPEG oder WebP, höchstens 8 MB, kein SVG)." }),
  filename: singleLineText(200).optional().meta({ description: "Ursprünglicher Dateiname, nur zur Info." }),
});

const storeImageSchema = z.object({ url: z.url(), width: z.number().int(), height: z.number().int() });

const storeBlockSchema = z
  .discriminatedUnion("type", [
    z.object({ id: z.string(), type: z.enum(["hero", "featured", "categories", "new"]) }),
    z.object({ id: z.string(), type: z.literal("text"), heading: z.string(), text: z.string() }),
    z.object({
      id: z.string(),
      type: z.literal("textImage"),
      heading: z.string(),
      text: z.string(),
      image: storeImageSchema.nullable(),
      imageSide: z.enum(["left", "right"]),
    }),
    z.object({ id: z.string(), type: z.literal("image"), image: storeImageSchema, caption: z.string() }),
    z.object({
      id: z.string(),
      type: z.literal("video"),
      provider: z.enum(["youtube", "vimeo"]),
      videoId: z.string().meta({ description: "Kennung beim Anbieter; die Einbettung baut die Storefront." }),
    }),
    z.object({ id: z.string(), type: z.literal("map"), address: z.string() }),
    z.object({ id: z.string(), type: z.literal("spacer"), size: z.enum(["s", "m", "l"]) }),
  ])
  .meta({ id: "StoreBlock", description: "Baustein der Startseite." });

const storeDesignSchema = z
  .object({
    accentColor: z.string(),
    accentDarkColor: z.string().meta({ description: "Dunklere Fassung für Links und „Maus darüber“." }),
    font: fontSchema,
    logo: storeImageSchema.nullable(),
    home: z
      .object({
        heroImage: storeImageSchema.nullable(),
        heroTitle: z.string().meta({ description: "Leer: der Shop zeigt seinen Standard." }),
        heroText: z.string().meta({ description: "Leer: der Shop zeigt seinen Standard." }),
        featuredProductIds: z.array(z.uuid()).meta({
          description:
            "Hervorgehobene Produkte in dieser Reihenfolge; nicht (mehr) sichtbare einfach auslassen.",
        }),
        showCategories: z.boolean(),
        showNew: z.boolean(),
        blocks: z.array(storeBlockSchema).meta({
          description:
            "Bausteine in Reihenfolge, fertig zum Anzeigen (ältere Shops: aus den Schaltern abgeleitet). " +
            "Leere Video-, Karten- und Bildbausteine fehlen.",
        }),
      })
      .meta({ id: "StoreDesignHome", description: "Inhalt der Startseite." }),
    tagline: z.string().meta({ description: "Text unter dem Logo; leer heißt keiner." }),
    footer: footerViewSchema,
  })
  .meta({ id: "StoreDesign", description: "Veröffentlichtes Aussehen eines Shops." });

/** Kleines gültiges PNG (32 × 32 Pixel) als Beispiel für Dokumentation und Tests. */
const EXAMPLE_PNG =
  "iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAMAAABEpIrGAAAAA1BMVEV6mluJCzqwAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAEkl" +
  "EQVQ4y2NgGAWjYBSMAuwAAAQgAAFWu83mAAAAAElFTkSuQmCC";

/** Baustein für die Storefront: Bilder aufgelöst, Video als Anbieter + ID, leere Bausteine fallen weg. */
function storeBlock(
  b: Block,
  image: (id: string | null) => { url: string; width: number; height: number } | null,
): z.input<typeof storeBlockSchema>[] {
  switch (b.type) {
    case "hero":
    case "featured":
    case "categories":
    case "new":
      return [{ id: b.id, type: b.type }];
    case "text":
      return b.heading === "" && b.text === "" ? [] : [{ ...b }];
    case "textImage":
      return [
        {
          id: b.id,
          type: b.type,
          heading: b.heading,
          text: b.text,
          image: image(b.imageId),
          imageSide: b.imageSide,
        },
      ];
    case "image": {
      const i = image(b.imageId);
      return i === null ? [] : [{ id: b.id, type: b.type, image: i, caption: b.caption }];
    }
    case "video": {
      const v = parseVideoUrl(b.url);
      return v === undefined ? [] : [{ id: b.id, type: b.type, provider: v.provider, videoId: v.id }];
    }
    case "map":
      return b.address.trim() === "" ? [] : [{ id: b.id, type: b.type, address: b.address.trim() }];
    case "spacer":
      return [{ ...b }];
  }
}

/** Fußzeile für Antworten: frische Arrays statt readonly. */
function footerView(f: FooterSettings) {
  return { text: f.text, links: f.links.map((l) => ({ label: l.label, url: l.url })) };
}

export interface DesignEndpointDependencies {
  readonly db: Database<DB>;
  readonly images: DesignImages;
}

export function designEndpoints({ db, images }: DesignEndpointDependencies): Endpoint[] {
  const tenant = () => getContext()?.tenantId ?? "";

  async function toState(i: Installation): Promise<z.infer<typeof designStateSchema>> {
    const found = await images.get([...new Set([...imagesOf(i.draft), ...imagesOf(i.published)])]);
    const image = (id: string | null) => (id === null ? null : (found.get(id) ?? null));
    const view = (s: DesignSettings) => ({
      accentColor: s.accentColor,
      font: s.font,
      logo: image(s.logoImageId),
      home: {
        ...s.home,
        featuredProductIds: [...s.home.featuredProductIds],
        heroImage: image(s.home.heroImageId),
        blocks: s.home.blocks === null ? null : s.home.blocks.map((b) => ({ ...b })),
        blockImages: blockImages(s.home.blocks).flatMap((id) => {
          const i = found.get(id);
          return i === undefined ? [] : [i];
        }),
      },
      tagline: s.tagline,
      footer: footerView(s.footer),
    });
    return {
      draft: view(i.draft),
      published: view(i.published),
      hasUnpublishedChanges: !sameSettings(i.draft, i.published),
      publishedAt: i.publishedAt?.toISOString() ?? null,
      version: i.version,
    };
  }

  /** Bilder (Logo, Startseite), die weder im Entwurf noch veröffentlicht vorkommen, samt Dateien löschen. */
  async function dropUnused(before: Installation, after: Installation): Promise<void> {
    const keep = new Set([...imagesOf(after.draft), ...imagesOf(after.published)]);
    const unused = [...imagesOf(before.draft), ...imagesOf(before.published)].filter((id) => !keep.has(id));
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
    description: "Entwurf und veröffentlichten Stand des Aussehens (Hauptfarbe, Schrift, Logo, Startseite).",
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
    bodyExample: {
      accentColor: "#1f5f8b",
      font: "modern",
      logoImageId: null,
      home: {
        heroImageId: null,
        heroTitle: "Frischer Tee, direkt vom Garten",
        heroText: "Lose Tees aus kleinen Teegärten, sorgfältig ausgewählt.",
        featuredProductIds: [],
        showCategories: true,
        showNew: true,
      },
      tagline: "Tee mit Herz seit 1998",
      footer: {
        text: "Mo–Fr 9–18 Uhr erreichbar.",
        links: [{ label: "Kontakt", url: "mailto:hallo@teeladen.example" }],
      },
    },
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
        const home: HomeSettings =
          body.home === undefined
            ? current.draft.home
            : {
                ...body.home,
                showNew: body.home.showNew ?? current.draft.home.showNew,
                blocks: body.home.blocks === undefined ? current.draft.home.blocks : body.home.blocks,
              };
        // Nur Bilder, die es in diesem Shop gibt (fremde oder erfundene IDs fehlen in der Antwort).
        const wanted = [
          { id: logo, path: "/logoImageId", detail: "Dieses Logo gibt es nicht. Bitte neu hochladen." },
          {
            id: home.heroImageId,
            path: "/home/heroImageId",
            detail: "Dieses Bild gibt es nicht. Bitte neu hochladen.",
          },
          ...(home.blocks ?? []).flatMap((b, i) =>
            (b.type === "image" || b.type === "textImage") && b.imageId !== null
              ? [
                  {
                    id: b.imageId,
                    path: `/home/blocks/${i}/imageId`,
                    detail: "Ein Bild in einem Baustein gibt es nicht. Bitte neu hochladen.",
                  },
                ]
              : [],
          ),
        ];
        const found = await images.get(wanted.flatMap((w) => (w.id === null ? [] : [w.id])));
        for (const w of wanted)
          if (w.id !== null && !found.has(w.id))
            throw new ValidationError({
              detail: w.detail,
              errors: [{ path: w.path, code: "unknown_image", message: "Unbekanntes Bild." }],
            });
        const tagline = body.tagline ?? current.draft.tagline;
        const footer: FooterSettings = body.footer ?? current.draft.footer;
        return { draft: { accentColor: accent, font: body.font, logoImageId: logo, home, tagline, footer } };
      });
    },
  });

  /** Bild hochladen (vor der Transaktion rechnen, das kann eine Sekunde dauern) und in den Entwurf setzen. */
  async function uploadInto(
    body: z.infer<typeof logoInput>,
    what: "Das Logo" | "Das Bild",
    put: (draft: DesignSettings, imageId: string) => DesignSettings,
  ) {
    const prepared = await images.prepare(Buffer.from(body.data, "base64"), body.filename);
    if (!prepared.ok) {
      const text = rejectionText(prepared.reason, what);
      throw new ValidationError({
        detail: text,
        errors: [{ path: "/data", code: prepared.reason, message: text }],
      });
    }
    const image = await prepared.save();
    return change(async (current) => ({ draft: put(current.draft, image.id) }));
  }

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
    handler: async ({ body }) => uploadInto(body, "Das Logo", (d, id) => ({ ...d, logoImageId: id })),
  });

  const uploadHero = defineEndpoint({
    api: "admin",
    method: "POST",
    path: "/design/hero-image",
    operationId: "uploadDesignHeroImage",
    summary: "Bild für die Startseite hochladen",
    description:
      "Lädt das große Bild oben auf der Startseite hoch (PNG, JPEG oder WebP als Base64, höchstens " +
      "8 MB, am besten im Querformat) und setzt es in den Entwurf. Ein vorheriges Bild des Entwurfs " +
      "wird gelöscht, wenn es nicht veröffentlicht ist.",
    tags: ["Aussehen"],
    access: access.write,
    body: logoInput,
    bodyExample: { data: EXAMPLE_PNG, filename: "startseite.png" },
    bodyLimit: LOGO_BODY_LIMIT,
    response: {
      status: 201,
      description: "Das Aussehen mit neuem Startseitenbild im Entwurf.",
      schema: designStateSchema,
    },
    problems: [413],
    handler: async ({ body }) =>
      uploadInto(body, "Das Bild", (d, id) => ({ ...d, home: { ...d.home, heroImageId: id } })),
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
    description:
      "Veröffentlichte Hauptfarbe, Schrift, Logo und Startseite. Unbekannte oder gesperrte Shops ergeben 404.",
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
      const found = await images.get(imagesOf(published));
      const image = (id: string | null) => {
        const i = id === null ? undefined : found.get(id);
        return i === undefined ? null : { url: i.url, width: i.width, height: i.height };
      };
      const { home } = published;
      return {
        accentColor: published.accentColor,
        accentDarkColor: darker(published.accentColor),
        font: published.font,
        logo: image(published.logoImageId),
        home: {
          heroImage: image(home.heroImageId),
          heroTitle: home.heroTitle,
          heroText: home.heroText,
          featuredProductIds: [...home.featuredProductIds],
          showCategories: home.showCategories,
          showNew: home.showNew,
          blocks: (home.blocks ?? legacyBlocks(home)).flatMap((b) => storeBlock(b, image)),
        },
        tagline: published.tagline,
        footer: footerView(published.footer),
      };
    },
  });

  const uploadBlockImage = defineEndpoint({
    api: "admin",
    method: "POST",
    path: "/design/images",
    operationId: "uploadDesignImage",
    summary: "Bild für einen Baustein hochladen",
    description:
      "Lädt ein Bild für einen Baustein der Startseite hoch (PNG, JPEG oder WebP als Base64, höchstens 8 MB). " +
      "Die Antwort nennt die Bild-ID; sie gilt erst, wenn ein Baustein im Entwurf sie benutzt.",
    tags: ["Aussehen"],
    access: access.write,
    body: logoInput,
    bodyExample: { data: EXAMPLE_PNG, filename: "laden.png" },
    bodyLimit: LOGO_BODY_LIMIT,
    response: { status: 201, description: "Das hochgeladene Bild.", schema: imageSchema },
    problems: [413],
    handler: async ({ body }) => {
      const prepared = await images.prepare(Buffer.from(body.data, "base64"), body.filename);
      if (!prepared.ok) {
        const text = rejectionText(prepared.reason, "Das Bild");
        throw new ValidationError({
          detail: text,
          errors: [{ path: "/data", code: prepared.reason, message: text }],
        });
      }
      return prepared.save();
    },
  });

  return [get, saveDraft, uploadLogo, uploadHero, uploadBlockImage, publish, discard, store];
}
