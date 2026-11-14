// Bild in Antworten der Admin- und Storefront-API (Produkte und Kategorien).
import { z } from "zod";

export const productImageSchema = z
  .object({
    id: z.uuid(),
    url: z.url().meta({ description: "Große Fassung (höchstens 1600 Pixel breit oder hoch), WebP." }),
    thumbnailUrl: z.url().meta({ description: "Kleine Fassung (höchstens 400 Pixel), WebP, für Listen." }),
    width: z.number().int().meta({ description: "Breite des Originals in Pixeln." }),
    height: z.number().int().meta({ description: "Höhe des Originals in Pixeln." }),
  })
  .meta({ id: "ProductImage", description: "Produktbild, ausgeliefert über media.<Domain>." });
