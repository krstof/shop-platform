// Adressvorschläge in der Kasse (22.11.2026).
//
// Während der Kunde seine Straße tippt, fragt die Kasse hier nach passenden Adressen. Die Daten
// kommen von Photon, dem freien Adressdienst von Komoot auf Basis von OpenStreetMap: kein
// Zugangsschlüssel, keine Anmeldung, keine Kosten.
//
// Der Endpunkt sitzt bewusst in der Store-API und nicht im Backoffice: Er wird vom Shop aufgerufen,
// also von jedem Besucher. Deshalb gibt er nur Adressen zurück, nie etwas über den Shop, und er
// nennt den fremden Dienst nach außen nicht (der Browser des Kunden spricht nie mit Photon, damit
// Photon nicht erfährt, wer gerade bei welchem Shop bestellt).
import { defineEndpoint, singleLineText, type Endpoint } from "@shop/http";
import type { Database, SecretBox } from "@shop/kernel";
import { z } from "zod";
import { createIntegrations } from "../internal/store.js";
import { ExternalServiceError, fetchExternal } from "../internal/outbound.js";

/** Grob das Rechteck um Deutschland. Der Testshop liefert nur nach Deutschland. */
const GERMANY_BBOX = "5.8,47.2,15.1,55.1";

const suggestionSchema = z
  .object({
    street: z.string().meta({ description: "Straße mit Hausnummer, soweit bekannt." }),
    postalCode: z.string(),
    city: z.string(),
    label: z.string().meta({ description: "Fertige Zeile zum Anzeigen in der Vorschlagsliste." }),
  })
  .meta({ id: "AddressSuggestion", description: "Ein Adressvorschlag." });

interface PhotonAnswer {
  readonly features?: readonly {
    readonly properties?: {
      readonly name?: string;
      readonly street?: string;
      readonly housenumber?: string;
      readonly postcode?: string;
      readonly city?: string;
      readonly district?: string;
      readonly countrycode?: string;
    };
  }[];
}

export interface StorePublicDependencies {
  readonly database: Database<unknown>;
  readonly secretBox: SecretBox;
}

export function storePublicEndpoints(deps: StorePublicDependencies): Endpoint[] {
  const integrations = createIntegrations(deps);

  const suggest = defineEndpoint({
    api: "store",
    method: "GET",
    path: "/shops/{shopHandle}/address-suggestions",
    operationId: "suggestAddresses",
    summary: "Adressvorschläge",
    description:
      "Schlägt zu einer angefangenen Straße passende Adressen in Deutschland vor, mit Postleitzahl " +
      "und Ort. Ist die Anbindung im Shop ausgeschaltet, kommt eine leere Liste zurück.",
    tags: ["Kasse"],
    access: {
      public: true,
      reason: "Die Kasse fragt beim Tippen der Straße; der Kunde ist dabei nicht angemeldet.",
    },
    params: z.strictObject({ shopHandle: singleLineText(60) }),
    query: z.strictObject({ q: singleLineText(120).default("") }),
    response: {
      status: 200,
      description: "Passende Adressen, höchstens fünf.",
      schema: z
        .object({ data: z.array(suggestionSchema) })
        .meta({ id: "AddressSuggestions", description: "Vorschläge für die Kasse." }),
    },
    handler: async ({ query }) => {
      const text = query.q.trim();
      // Unter drei Zeichen lohnt keine Anfrage, und sie würde halb Deutschland zurückgeben.
      if (text.length < 3) return { data: [] };
      if ((await integrations.credentials("photon")) === undefined) return { data: [] };
      const params = new URLSearchParams({ q: text, lang: "de", limit: "8", bbox: GERMANY_BBOX });
      let answer: PhotonAnswer;
      try {
        answer = await fetchExternal<PhotonAnswer>({
          url: `https://photon.komoot.io/api/?${params.toString()}`,
          service: "Der Adressdienst",
          timeoutMs: 5000,
        });
      } catch (error) {
        // Ein Ausfall darf den Kauf nicht aufhalten: Dann tippt der Kunde die Adresse eben selbst.
        if (error instanceof ExternalServiceError) return { data: [] };
        throw error;
      }
      const seen = new Set<string>();
      const data = [];
      for (const feature of answer.features ?? []) {
        const p = feature.properties;
        if (p === undefined || p.countrycode !== "DE") continue;
        const street = p.street ?? p.name ?? "";
        const city = p.city ?? p.district ?? "";
        if (street === "" || p.postcode === undefined || city === "") continue;
        const full = p.housenumber === undefined ? street : `${street} ${p.housenumber}`;
        const label = `${full}, ${p.postcode} ${city}`;
        if (seen.has(label)) continue;
        seen.add(label);
        data.push({ street: full, postalCode: p.postcode, city, label });
        if (data.length === 5) break;
      }
      return { data };
    },
  });

  const indexNowKey = defineEndpoint({
    api: "store",
    method: "GET",
    path: "/shops/{shopHandle}/indexnow-key",
    operationId: "getIndexNowKey",
    summary: "Schlüssel für IndexNow",
    description:
      "Der Schlüssel, mit dem der Shop Bing und Yandex meldet, dass sich etwas geändert hat. Er ist " +
      "nicht geheim: Die Suchmaschine prüft damit, dass die Meldung wirklich von diesem Shop kommt, " +
      "und holt ihn selbst unter der Adresse des Shops ab.",
    tags: ["Shop"],
    access: {
      public: true,
      reason: "Der Schlüssel muss öffentlich abrufbar sein, sonst kann die Suchmaschine ihn nicht prüfen.",
    },
    params: z.strictObject({ shopHandle: singleLineText(60) }),
    response: {
      status: 200,
      description: "Der Schlüssel, oder null, wenn die Anbindung aus ist.",
      schema: z
        .object({ key: z.string().nullable() })
        .meta({ id: "IndexNowKey", description: "Schlüssel für IndexNow." }),
    },
    handler: async () => ({ key: (await integrations.searchEngineKey()) ?? null }),
  });

  return [suggest, indexNowKey];
}
