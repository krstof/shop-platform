// Doppelte Adresse (slug) oder Artikelnummer: Die Datenbank meldet 23505, die API antwortet 409.
import { ConflictError } from "@shop/kernel";

const MESSAGES: Readonly<Record<string, { detail: string; path: string }>> = {
  slug: { detail: "Diese Adresse (slug) ist im Shop schon vergeben.", path: "/slug" },
  sku: { detail: "Diese Artikelnummer ist im Shop schon vergeben.", path: "/sku" },
};

function fieldOf(error: unknown): "slug" | "sku" | undefined {
  if (typeof error !== "object" || error === null) return undefined;
  const e = error as { code?: unknown; constraint?: unknown };
  if (e.code !== "23505" || typeof e.constraint !== "string") return undefined;
  if (e.constraint.endsWith("_slug_key")) return "slug";
  if (e.constraint === "variant_sku_idx") return "sku";
  return undefined;
}

/** Führt `fn` aus und übersetzt doppelte Adressen und Artikelnummern in einen 409er. */
export async function withConflictMapping<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    const field = fieldOf(error);
    if (field === undefined) throw error;
    const m = MESSAGES[field];
    throw new ConflictError({
      detail: m?.detail ?? "",
      errors: [{ path: m?.path ?? "", code: `${field}_taken`, message: m?.detail ?? "" }],
      cause: error,
    });
  }
}
