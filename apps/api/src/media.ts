// Bilder (M2 Teil 2): Modul media mit dem Objektspeicher aus den Einstellungen (lokal Garage).
import type { Database } from "@shop/kernel";
import { createMedia, createS3Storage, type Media } from "@shop/media";
import type { ApiConfig } from "./config.js";

export function mediaFromConfig(config: Readonly<ApiConfig>, database: Database<unknown>): Media {
  return createMedia({
    database,
    storage: createS3Storage({
      endpoint: config.SHOP_S3_ENDPOINT,
      region: config.SHOP_S3_REGION,
      accessKeyId: config.SHOP_S3_ACCESS_KEY_ID,
      secretAccessKey: config.SHOP_S3_SECRET_ACCESS_KEY,
      publicBucket: config.SHOP_S3_BUCKET_PUBLIC,
      privateBucket: config.SHOP_S3_BUCKET_PRIVATE,
    }),
    publicBaseUrl: config.SHOP_MEDIA_BASE_URL,
  });
}
