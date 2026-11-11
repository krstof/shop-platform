// Kurzname eines neuen Shops (M8), Teil der Shop-Adresse. Regel wie in der API: a–z, 0–9, Bindestrich.

/** Kurzname aus dem Shopnamen: „Bäckerei Müller“ → „baeckerei-mueller“. */
export function handleFromName(name: string): string {
  return name
    .toLowerCase()
    .replace(/ä/g, "ae")
    .replace(/ö/g, "oe")
    .replace(/ü/g, "ue")
    .replace(/ß/g, "ss")
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 63)
    .replace(/-+$/g, "");
}
