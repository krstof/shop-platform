// EINZIGE öffentliche Datei des Moduls media (Architektur 3.3, Regel 3).
// MVP-Etappe M2 Teil 2: Bilder für Produkte. Einfachster Weg: Das Bild kommt über die API (nicht
// über eine signierte Upload-Adresse), wird sofort geprüft und umgerechnet und ist danach fertig
// (Status `ready`). Ausgeliefert wird über media.<Domain> direkt aus dem öffentlichen Bereich.
//
// Ablauf für Aufrufer: 1. `prepareImage` (rechnet, ohne Datenbank, außerhalb jeder Transaktion),
// 2. `saveImage` (lädt hoch und trägt ein, läuft in der Transaktion des Aufrufers mit),
// 3. `getImages` zum Anzeigen, 4. `deleteImages` nach dem Entfernen (eigene Transaktion).
import { getContext, uuidv7, withTenantTransaction, type Database } from "@shop/kernel";
import type { DB } from "./db.generated.js";
import { prepareImage, type PreparedImage, type PrepareResult } from "./internal/image.js";
import { prepareVideo, type PrepareVideoResult, type PreparedVideo } from "./internal/video.js";
import type { ObjectStorage } from "./internal/storage.js";

export {
  MAX_IMAGE_BYTES,
  type ImageRejection,
  type PreparedImage,
  type PrepareResult,
} from "./internal/image.js";
export {
  MAX_VIDEO_BYTES,
  type PreparedVideo,
  type PrepareVideoResult,
  type VideoRejection,
} from "./internal/video.js";
export {
  createS3Storage,
  memoryStorage,
  type Bucket,
  type ObjectStorage,
  type S3StorageConfig,
  type StoredObject,
} from "./internal/storage.js";

export interface MediaDependencies {
  /** Verbindung als Rolle shop_app. */
  readonly database: Database<unknown>;
  readonly storage: ObjectStorage;
  /** Öffentliche Adresse des Bereichs „public“, etwa https://media.localhost (ohne / am Ende). */
  readonly publicBaseUrl: string;
}

/** Ein fertiges Bild, so wie Oberflächen es brauchen. */
export interface MediaImage {
  readonly id: string;
  /** Große Fassung (höchstens 1600 Pixel), WebP. */
  readonly url: string;
  /** Kleine Fassung (höchstens 400 Pixel), WebP, für Listen. */
  readonly thumbnailUrl: string;
  /** Maße des aufgerichteten Originals. */
  readonly width: number;
  readonly height: number;
}

/** Ein fertiges Video, so wie Oberflächen es brauchen (P5). */
export interface MediaVideo {
  readonly id: string;
  /** Adresse der Datei, direkt abspielbar (`<video src=…>`). */
  readonly url: string;
  readonly mimeType: string;
  readonly byteSize: number;
}

export interface Media {
  prepareImage(data: Uint8Array, filename?: string): Promise<PrepareResult>;
  saveImage(image: PreparedImage): Promise<MediaImage>;
  /** Fertige Bilder zu den IDs. Unbekannte oder fremde IDs fehlen in der Antwort. */
  getImages(ids: readonly string[]): Promise<Map<string, MediaImage>>;
  /** Löscht Bilder samt Dateien. Fehlende IDs sind kein Fehler. */
  deleteImages(ids: readonly string[]): Promise<void>;
  /** Prüft eine Videodatei (MP4 oder WebM, höchstens 25 MB), ohne Datenbank. */
  prepareVideo(data: Uint8Array, filename?: string): PrepareVideoResult;
  /** Legt ein geprüftes Video ab und trägt es ein. */
  saveVideo(video: PreparedVideo): Promise<MediaVideo>;
  /** Fertige Videos zu den IDs. Unbekannte oder fremde IDs fehlen in der Antwort. */
  getVideos(ids: readonly string[]): Promise<Map<string, MediaVideo>>;
  /** Löscht Videos samt Dateien. Fehlende IDs sind kein Fehler. */
  deleteVideos(ids: readonly string[]): Promise<void>;
}

/** Dateien eines Bildes im Speicher: tenants/<shop>/media/<bild>/… (wie im Datenmodell). */
function assetPrefix(tenantId: string, id: string): string {
  return `tenants/${tenantId}/media/${id}`;
}

const IMMUTABLE = "public, max-age=31536000, immutable";

export function createMedia(deps: MediaDependencies): Media {
  const db = deps.database as Database<DB>;
  const base = deps.publicBaseUrl.replace(/\/+$/, "");
  const url = (key: string) => `${base}/${key}`;

  function tenant(): string {
    const id = getContext()?.tenantId;
    if (id === undefined) throw new Error("media: kein Shop im Anfrage-Kontext");
    return id;
  }

  return {
    prepareImage,

    async saveImage(image) {
      const tenantId = tenant();
      const id = uuidv7();
      const prefix = assetPrefix(tenantId, id);
      const originalKey = `${prefix}/original`;
      const keys = image.renditions.map((r) => ({ ...r, key: `${prefix}/${r.preset}.webp` }));
      // Erst die Dateien, dann die Zeilen: So zeigt die Datenbank nie auf etwas, das fehlt.
      await deps.storage.put({
        bucket: "private",
        key: originalKey,
        body: image.original,
        contentType: image.mimeType,
      });
      await Promise.all(
        keys.map((r) =>
          deps.storage.put({
            bucket: "public",
            key: r.key,
            body: r.data,
            contentType: "image/webp",
            cacheControl: IMMUTABLE,
          }),
        ),
      );
      try {
        await withTenantTransaction(db, async (trx) => {
          await trx
            .insertInto("media.media_asset")
            .values({
              tenant_id: tenantId,
              id,
              kind: "image",
              storage_key: originalKey,
              original_filename: image.filename,
              mime_type: image.mimeType,
              byte_size: image.original.length,
              width: image.width,
              height: image.height,
              checksum_sha256: image.checksum,
              status: "ready",
            })
            .execute();
          await trx
            .insertInto("media.media_rendition")
            .values(
              keys.map((r) => ({
                tenant_id: tenantId,
                media_asset_id: id,
                preset: r.preset,
                format: "webp",
                width: r.width,
                height: r.height,
                byte_size: r.data.length,
                storage_key: r.key,
              })),
            )
            .execute();
        });
      } catch (error) {
        await removeFiles(
          [originalKey],
          keys.map((k) => k.key),
        ).catch(() => undefined);
        throw error;
      }
      const large = keys.find((k) => k.preset === "w1600") ?? keys[0];
      const small = keys.find((k) => k.preset === "w400") ?? large;
      if (large === undefined || small === undefined) throw new Error("media: keine Fassung erzeugt");
      return {
        id,
        url: url(large.key),
        thumbnailUrl: url(small.key),
        width: image.width,
        height: image.height,
      };
    },

    prepareVideo,

    async saveVideo(video) {
      const tenantId = tenant();
      const id = uuidv7();
      // Anders als beim Bild liegt die Datei im öffentlichen Bereich: Der Shop liefert sie
      // unverändert aus, es gibt keine umgerechnete Fassung, die man stattdessen zeigen könnte.
      const key = `${assetPrefix(tenantId, id)}/video.${video.format}`;
      await deps.storage.put({
        bucket: "public",
        key,
        body: video.data,
        contentType: video.mimeType,
        cacheControl: IMMUTABLE,
      });
      try {
        await withTenantTransaction(db, (trx) =>
          trx
            .insertInto("media.media_asset")
            .values({
              tenant_id: tenantId,
              id,
              kind: "video",
              storage_key: key,
              original_filename: video.filename,
              mime_type: video.mimeType,
              byte_size: video.data.length,
              checksum_sha256: video.checksum,
              status: "ready",
            })
            .execute(),
        );
      } catch (error) {
        await deps.storage.delete("public", [key]).catch(() => undefined);
        throw error;
      }
      return { id, url: url(key), mimeType: video.mimeType, byteSize: video.data.length };
    },

    async getVideos(ids) {
      const result = new Map<string, MediaVideo>();
      if (ids.length === 0) return result;
      const rows = await withTenantTransaction(db, (trx) =>
        trx
          .selectFrom("media.media_asset")
          .select(["id", "storage_key", "mime_type", "byte_size"])
          .where("id", "in", [...ids])
          .where("status", "=", "ready")
          .where("kind", "=", "video")
          .execute(),
      );
      for (const r of rows)
        result.set(r.id, {
          id: r.id,
          url: url(r.storage_key),
          mimeType: r.mime_type,
          byteSize: Number(r.byte_size ?? 0),
        });
      return result;
    },

    async deleteVideos(ids) {
      if (ids.length === 0) return;
      const keys = await withTenantTransaction(db, async (trx) =>
        (
          await trx
            .deleteFrom("media.media_asset")
            .where("id", "in", [...ids])
            .where("kind", "=", "video")
            .returning("storage_key")
            .execute()
        ).map((r) => r.storage_key),
      );
      await deps.storage.delete("public", keys);
    },

    async getImages(ids) {
      const result = new Map<string, MediaImage>();
      if (ids.length === 0) return result;
      const rows = await withTenantTransaction(db, (trx) =>
        trx
          .selectFrom("media.media_asset as a")
          .innerJoin("media.media_rendition as r", "r.media_asset_id", "a.id")
          .select(["a.id", "a.width", "a.height", "r.preset", "r.storage_key"])
          .where("a.id", "in", [...ids])
          .where("a.status", "=", "ready")
          .where("a.kind", "=", "image")
          .execute(),
      );
      const byId = new Map<string, { width: number; height: number; presets: Map<string, string> }>();
      for (const r of rows) {
        const entry = byId.get(r.id) ?? { width: r.width ?? 0, height: r.height ?? 0, presets: new Map() };
        entry.presets.set(r.preset, r.storage_key);
        byId.set(r.id, entry);
      }
      for (const [id, e] of byId) {
        const large = e.presets.get("w1600");
        const small = e.presets.get("w400") ?? large;
        if (large === undefined || small === undefined) continue;
        result.set(id, { id, url: url(large), thumbnailUrl: url(small), width: e.width, height: e.height });
      }
      return result;
    },

    async deleteImages(ids) {
      if (ids.length === 0) return;
      const removed = await withTenantTransaction(db, async (trx) => {
        const renditions = await trx
          .selectFrom("media.media_rendition")
          .select("storage_key")
          .where("media_asset_id", "in", [...ids])
          .execute();
        const assets = await trx
          .deleteFrom("media.media_asset")
          .where("id", "in", [...ids])
          .returning("storage_key")
          .execute();
        return {
          originals: assets.map((a) => a.storage_key),
          renditions: renditions.map((r) => r.storage_key),
        };
      });
      await removeFiles(removed.originals, removed.renditions);
    },
  };

  async function removeFiles(originals: readonly string[], renditions: readonly string[]): Promise<void> {
    await Promise.all([deps.storage.delete("private", originals), deps.storage.delete("public", renditions)]);
  }
}
