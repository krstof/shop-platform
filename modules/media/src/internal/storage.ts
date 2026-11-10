// Objektspeicher über die S3-Schnittstelle (ADR-001: Garage, austauschbar). Zwei Bereiche:
// „public“ wird über media.<Domain> ausgeliefert, „private“ nie (Originale mit Zusatzdaten).
import { DeleteObjectsCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";

export type Bucket = "public" | "private";

export interface StoredObject {
  readonly bucket: Bucket;
  readonly key: string;
  readonly body: Buffer;
  readonly contentType: string;
  readonly cacheControl?: string;
}

export interface ObjectStorage {
  put(object: StoredObject): Promise<void>;
  /** Löscht die Schlüssel; fehlende Schlüssel sind kein Fehler. */
  delete(bucket: Bucket, keys: readonly string[]): Promise<void>;
}

export interface S3StorageConfig {
  /** Adresse der S3-Schnittstelle, etwa http://garage:3900. */
  readonly endpoint: string;
  readonly region: string;
  readonly accessKeyId: string;
  readonly secretAccessKey: string;
  readonly publicBucket: string;
  readonly privateBucket: string;
}

export function createS3Storage(config: S3StorageConfig): ObjectStorage {
  const client = new S3Client({
    endpoint: config.endpoint,
    region: config.region,
    // Garage kennt Bereiche nur im Pfad (http://garage:3900/<bucket>/<key>), nicht als Unteradresse.
    forcePathStyle: true,
    credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey },
    // Garage rechnet keine CRC32-Prüfsummen, die das SDK sonst bei jedem Upload mitschickt.
    requestChecksumCalculation: "WHEN_REQUIRED",
    responseChecksumValidation: "WHEN_REQUIRED",
  });
  const name = (b: Bucket) => (b === "public" ? config.publicBucket : config.privateBucket);
  return {
    async put(o) {
      await client.send(
        new PutObjectCommand({
          Bucket: name(o.bucket),
          Key: o.key,
          Body: o.body,
          ContentType: o.contentType,
          ...(o.cacheControl === undefined ? {} : { CacheControl: o.cacheControl }),
        }),
      );
    },
    async delete(bucket, keys) {
      if (keys.length === 0) return;
      await client.send(
        new DeleteObjectsCommand({
          Bucket: name(bucket),
          Delete: { Objects: keys.map((Key) => ({ Key })), Quiet: true },
        }),
      );
    },
  };
}

/** Speicher im Arbeitsspeicher, nur für Tests und die Erzeugung der OpenAPI-Dateien. */
export function memoryStorage(): ObjectStorage & { readonly objects: Map<string, StoredObject> } {
  const objects = new Map<string, StoredObject>();
  return {
    objects,
    async put(o) {
      objects.set(`${o.bucket}:${o.key}`, o);
    },
    async delete(bucket, keys) {
      for (const k of keys) objects.delete(`${bucket}:${k}`);
    },
  };
}
