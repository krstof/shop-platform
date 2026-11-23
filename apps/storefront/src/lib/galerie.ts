// Galerie auf der Produktseite: welches Bild groß gezeigt wird (?bild=N, ab 1). Hat das Produkt
// ein Video (P5), zeigt ?bild=video das Video groß; ohne Angabe bleibt das Hauptbild vorn.

/** Gültige Bildnummer zwischen 1 und `anzahl`; alles andere zeigt das erste Bild. */
export function bildNummer(roh: string | null | undefined, anzahl: number): number {
  if (roh === null || roh === undefined || !/^[1-9][0-9]{0,2}$/.test(roh)) return 1;
  const n = Number(roh);
  return n <= anzahl ? n : 1;
}

/** Zeigt die Galerie gerade das Video? */
export const VIDEO_WAHL = "video";

export function zeigtVideo(roh: string | null | undefined, hatVideo: boolean): boolean {
  return hatVideo && roh === VIDEO_WAHL;
}
