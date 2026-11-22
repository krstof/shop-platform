// Bildersuche für den Baukasten-Editor und die Produktpflege (21.11.2026).
//
// Zwei Quellen:
// - **Openverse** ist immer da und braucht keinen Schlüssel. Gesucht wird nur in gemeinfreien
//   Bildern (CC0 und Public Domain Mark), damit kein Händler versehentlich ein Bild einbaut, das
//   eine Namensnennung verlangt.
// - **Unsplash** kommt dazu, sobald ein Schlüssel hinterlegt ist. Unsplash verlangt, dass die
//   Fotografin genannt wird; deshalb liefert die Suche den fertigen Satz dafür mit.
//
// Der Browser bekommt nie den Schlüssel und lädt das Bild auch nie selbst beim Anbieter: Er fragt
// hier nach den Bilddaten, und der Server holt sie. Die Adresse des Bildes stammt immer aus der
// Antwort des Anbieters, nie aus dem Browser (sonst wäre es ein Weg ins eigene Netz).
import { defineEndpoint, singleLineText, type Endpoint } from "@shop/http";
import { ValidationError, type Database, type SecretBox } from "@shop/kernel";
import { z } from "zod";
import { createIntegrations } from "../internal/store.js";
import { ExternalServiceError, fetchExternal, fetchExternalImage } from "../internal/outbound.js";

const SOURCES = ["openverse", "unsplash"] as const;
type Source = (typeof SOURCES)[number];

const photoSchema = z
  .object({
    source: z.enum(SOURCES),
    id: z.string(),
    title: z.string(),
    thumbnailUrl: z.string().meta({ description: "Kleine Vorschau, direkt beim Anbieter." }),
    width: z.number().int(),
    height: z.number().int(),
    license: z.string().meta({ description: "Kurzname der Lizenz, etwa „cc0“." }),
    attribution: z
      .string()
      .meta({ description: "Fertiger Satz zur Namensnennung; leer, wenn keine nötig ist." }),
    pageUrl: z.string().meta({ description: "Seite des Bildes beim Anbieter." }),
  })
  .meta({ id: "StockPhoto", description: "Ein gefundenes Bild." });

const resultSchema = z
  .object({
    data: z.array(photoSchema),
    sources: z.array(z.enum(SOURCES)).meta({ description: "Welche Quellen durchsucht wurden." }),
  })
  .meta({ id: "StockPhotoSearch", description: "Treffer der Bildersuche." });

interface OpenverseResult {
  readonly results?: readonly {
    readonly id: string;
    readonly title?: string;
    readonly thumbnail?: string;
    readonly url?: string;
    readonly width?: number;
    readonly height?: number;
    readonly license?: string;
    readonly attribution?: string;
    readonly foreign_landing_url?: string;
  }[];
}

interface UnsplashResult {
  readonly results?: readonly {
    readonly id: string;
    readonly description?: string | null;
    readonly alt_description?: string | null;
    readonly width?: number;
    readonly height?: number;
    readonly urls?: { readonly small?: string; readonly regular?: string };
    readonly links?: { readonly html?: string; readonly download_location?: string };
    readonly user?: { readonly name?: string; readonly links?: { readonly html?: string } };
  }[];
}

/** Nur gemeinfreie Bilder, damit niemand versehentlich eine Namensnennung schuldig bleibt. */
function openverseUrl(query: string, limit: number): string {
  const params = new URLSearchParams({
    q: query,
    page_size: String(limit),
    license: "cc0,pdm",
    mature: "false",
  });
  return `https://api.openverse.org/v1/images/?${params.toString()}`;
}

async function searchOpenverse(query: string, limit: number): Promise<z.input<typeof photoSchema>[]> {
  const found = await fetchExternal<OpenverseResult>({
    url: openverseUrl(query, limit),
    service: "Openverse",
    timeoutMs: 12000,
  });
  return (found.results ?? [])
    .filter((r) => r.thumbnail !== undefined && r.url !== undefined)
    .map((r) => ({
      source: "openverse" as const,
      id: r.id,
      title: r.title ?? "Ohne Titel",
      thumbnailUrl: r.thumbnail ?? "",
      width: r.width ?? 0,
      height: r.height ?? 0,
      license: (r.license ?? "cc0").toUpperCase(),
      attribution: "",
      pageUrl: r.foreign_landing_url ?? "",
    }));
}

async function searchUnsplash(
  query: string,
  limit: number,
  accessKey: string,
): Promise<z.input<typeof photoSchema>[]> {
  const params = new URLSearchParams({ query, per_page: String(limit), content_filter: "high" });
  const found = await fetchExternal<UnsplashResult>({
    url: `https://api.unsplash.com/search/photos?${params.toString()}`,
    headers: { authorization: `Client-ID ${accessKey}` },
    service: "Unsplash",
    timeoutMs: 12000,
  });
  return (found.results ?? [])
    .filter((r) => r.urls?.small !== undefined)
    .map((r) => ({
      source: "unsplash" as const,
      id: r.id,
      title: r.description ?? r.alt_description ?? "Ohne Titel",
      thumbnailUrl: r.urls?.small ?? "",
      width: r.width ?? 0,
      height: r.height ?? 0,
      license: "Unsplash",
      attribution: `Foto: ${r.user?.name ?? "unbekannt"} auf Unsplash`,
      pageUrl: r.links?.html ?? "",
    }));
}

export interface StockPhotoDependencies {
  readonly database: Database<unknown>;
  readonly secretBox: SecretBox;
}

export function stockPhotoEndpoints(deps: StockPhotoDependencies): Endpoint[] {
  const integrations = createIntegrations(deps);

  const unsplashKey = async (): Promise<string | undefined> => {
    const connection = await integrations.credentials("unsplash");
    const key = connection?.secrets["accessKey"] ?? "";
    return key === "" ? undefined : key;
  };

  const search = defineEndpoint({
    api: "admin",
    method: "GET",
    path: "/stock-photos",
    operationId: "searchStockPhotos",
    summary: "Bilder suchen",
    description:
      "Sucht Bilder zum Einbauen in Shop und Produkte. Openverse ist immer dabei und liefert nur " +
      "gemeinfreie Bilder. Unsplash kommt dazu, sobald in den Anbindungen ein Schlüssel hinterlegt ist.",
    tags: ["Medien"],
    access: { scopes: ["products:write"] },
    // Ohne Suchwort kommt eine leere Liste zurück, ohne irgendeinen Dienst zu fragen. Das hält den
    // Endpunkt auch für Prüfungen harmlos, die jeden GET einmal ohne Angaben aufrufen.
    query: z.strictObject({
      query: singleLineText(100).default(""),
      limit: z.coerce.number().int().min(1).max(40).default(24),
    }),
    response: { status: 200, description: "Gefundene Bilder.", schema: resultSchema },
    problems: [429],
    handler: async ({ query }) => {
      const text = query.query.trim();
      if (text === "") return { data: [], sources: ["openverse" as const] };
      const key = await unsplashKey();
      const sources: Source[] = key === undefined ? ["openverse"] : ["openverse", "unsplash"];
      // Eine Quelle, die gerade klemmt, darf die andere nicht mitreißen. Klemmen aber alle, die
      // gefragt wurden, ist das ein Fehler und kein „nichts gefunden“ — sonst sucht der Händler
      // nach anderen Wörtern, während in Wahrheit der Dienst nicht erreichbar ist.
      const found = await Promise.allSettled(
        sources.map((source) =>
          source === "openverse"
            ? searchOpenverse(text, query.limit)
            : searchUnsplash(text, query.limit, key ?? ""),
        ),
      );
      const failed = found.filter((r) => r.status === "rejected");
      if (failed.length === found.length) {
        const reason = failed[0]?.reason as unknown;
        throw reason instanceof ExternalServiceError
          ? reason
          : new ExternalServiceError("Die Bildersuche klemmt.");
      }
      const data = found.flatMap((r) => (r.status === "fulfilled" ? r.value : []));
      return { data, sources };
    },
  });

  const download = defineEndpoint({
    api: "admin",
    method: "POST",
    path: "/stock-photos/download",
    operationId: "downloadStockPhoto",
    summary: "Gefundenes Bild holen",
    description:
      "Holt ein gefundenes Bild beim Anbieter und gibt es als Base64 zurück. Damit lädt das " +
      "Backoffice es über die gewohnten Wege hoch, als Produktbild, Kategoriebild oder im Editor.",
    tags: ["Medien"],
    access: { scopes: ["products:write"] },
    body: z.strictObject({ source: z.enum(SOURCES), id: singleLineText(100) }),
    bodyExample: { source: "openverse", id: "9bd5b90f-664f-464d-81b6-44f649429ffa" },
    response: {
      status: 200,
      description: "Die Bilddaten.",
      schema: z
        .object({
          data: z.string().meta({ description: "Das Bild als Base64." }),
          filename: z.string(),
          attribution: z.string(),
        })
        .meta({ id: "StockPhotoData", description: "Ein geholtes Bild zum Hochladen." }),
    },
    problems: [404],
    handler: async ({ body }) => {
      const { url, attribution, service } = await resolve(body.source, body.id, await unsplashKey());
      const image = await fetchExternalImage(url, service);
      const extension = image.contentType.split("/")[1]?.replace("jpeg", "jpg") ?? "jpg";
      return {
        data: image.bytes.toString("base64"),
        filename: `${body.source}-${body.id.slice(0, 12)}.${extension}`,
        attribution,
      };
    },
  });

  return [search, download];
}

interface Resolved {
  readonly url: string;
  readonly attribution: string;
  readonly service: string;
}

/** Fragt den Anbieter nach der echten Bildadresse. Nie die Adresse aus dem Browser übernehmen. */
async function resolve(source: Source, id: string, unsplashAccessKey: string | undefined): Promise<Resolved> {
  if (source === "openverse") {
    const found = await fetchExternal<{ url?: string; attribution?: string }>({
      url: `https://api.openverse.org/v1/images/${encodeURIComponent(id)}/`,
      service: "Openverse",
    });
    if (found.url === undefined) throw new ValidationError({ detail: "Dieses Bild gibt es nicht mehr." });
    return { url: found.url, attribution: "", service: "Openverse" };
  }
  if (unsplashAccessKey === undefined)
    throw new ValidationError({ detail: "Für Unsplash ist kein Schlüssel hinterlegt." });
  const found = await fetchExternal<{
    urls?: { regular?: string };
    links?: { download_location?: string };
    user?: { name?: string };
  }>({
    url: `https://api.unsplash.com/photos/${encodeURIComponent(id)}`,
    headers: { authorization: `Client-ID ${unsplashAccessKey}` },
    service: "Unsplash",
  });
  if (found.urls?.regular === undefined)
    throw new ValidationError({ detail: "Dieses Bild gibt es nicht mehr." });
  // Unsplash verlangt, dass ein Herunterladen gemeldet wird. Scheitert das, ist das kein Grund,
  // dem Händler das Bild zu verweigern.
  if (found.links?.download_location !== undefined)
    await fetchExternal({
      url: found.links.download_location,
      headers: { authorization: `Client-ID ${unsplashAccessKey}` },
      service: "Unsplash",
    }).catch(() => undefined);
  return {
    url: found.urls.regular,
    attribution: `Foto: ${found.user?.name ?? "unbekannt"} auf Unsplash`,
    service: "Unsplash",
  };
}
