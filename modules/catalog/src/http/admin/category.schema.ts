// Ein- und Ausgaben für Kategorien in der Admin-API (M2).
import { multiLineText, singleLineText, timestamp } from "@shop/http";
import { z } from "zod";
import type { CategoryRow, CategoryValues } from "../../internal/category-repository.js";
import type { ProductImage } from "../../ports.js";
import { productImageSchema } from "./image.schema.js";

export const slugInput = z
  .string()
  .min(1)
  .max(80)
  .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, "Nur Kleinbuchstaben, Ziffern und einzelne Bindestriche.")
  .meta({ description: "Teil der Adresse im Shop, zum Beispiel `gruentee`. Ohne Angabe aus dem Namen." });

export const categorySchema = z
  .object({
    id: z.uuid(),
    name: z.string(),
    slug: z.string(),
    description: z.string().meta({ description: "Klartext, Absätze durch Leerzeilen getrennt." }),
    position: z.number().int(),
    visible: z.boolean().meta({ description: "Im Shop sichtbar." }),
    image: productImageSchema
      .nullable()
      .meta({ description: "Bild für Kacheln auf der Startseite und den Kopf der Kategorieseite." }),
    createdAt: timestamp,
    updatedAt: timestamp,
    version: z.number().int().positive(),
  })
  .meta({ id: "Category", description: "Kategorie (Warengruppe) im Shop." });

export type Category = z.infer<typeof categorySchema>;

export function toCategory(row: CategoryRow, image?: ProductImage): Category {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    description: row.description,
    position: row.position,
    visible: row.status === "visible",
    image: image === undefined ? null : { ...image },
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
    version: row.version,
  };
}

const fields = {
  slug: slugInput.optional(),
  description: multiLineText(5000).nullable().optional(),
  position: z.number().int().min(0).max(100_000).optional(),
  visible: z.boolean().optional(),
};

export const createCategoryInput = z.strictObject({ name: singleLineText(100), ...fields });
export const updateCategoryInput = z
  .strictObject({ name: singleLineText(100).optional(), ...fields })
  .refine((v) => Object.keys(v).length > 0, "Mindestens ein Feld ändern.")
  .meta({ minProperties: 1 });

export function toCategoryValues(input: z.output<typeof updateCategoryInput>): CategoryValues {
  const v: CategoryValues = {};
  if (input.name !== undefined) v.name = input.name;
  if (input.slug !== undefined) v.slug = input.slug;
  if (input.description !== undefined) v.description = input.description;
  if (input.position !== undefined) v.position = input.position;
  if (input.visible !== undefined) v.status = input.visible ? "visible" : "hidden";
  return v;
}

/** Felder für das Änderungs-Ereignis. */
export function categoryFacts(c: Category): Record<string, string | number | null> {
  return {
    name: c.name,
    slug: c.slug,
    description: c.description,
    position: c.position,
    visible: String(c.visible),
  };
}
