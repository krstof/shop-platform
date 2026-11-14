// Auswahl „Sortieren“ auf Startseite, Kategorie- und Suchseite (Werte wie in der Storefront-API).

export const SORTIERUNGEN = [
  { wert: "standard", text: "Empfohlen" },
  { wert: "newest", text: "Neueste zuerst" },
  { wert: "price-asc", text: "Preis aufsteigend" },
  { wert: "price-desc", text: "Preis absteigend" },
  { wert: "name", text: "Name A–Z" },
] as const;

export type Sortierung = (typeof SORTIERUNGEN)[number]["wert"];

/** Wert aus der Adresse (`?sortierung=…`); Unbekanntes gilt als „standard“. */
export function sortierung(roh: string | null | undefined): Sortierung {
  return SORTIERUNGEN.find((s) => s.wert === roh)?.wert ?? "standard";
}
