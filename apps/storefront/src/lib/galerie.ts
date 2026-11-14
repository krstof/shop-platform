// Galerie auf der Produktseite: welches Bild groß gezeigt wird (?bild=N, ab 1).

/** Gültige Bildnummer zwischen 1 und `anzahl`; alles andere zeigt das erste Bild. */
export function bildNummer(roh: string | null | undefined, anzahl: number): number {
  if (roh === null || roh === undefined || !/^[1-9][0-9]{0,2}$/.test(roh)) return 1;
  const n = Number(roh);
  return n <= anzahl ? n : 1;
}
