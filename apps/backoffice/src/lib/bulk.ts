// Mehrfachauswahl in der Produktliste: welche Produkte eine Sammelaktion wirklich ändert.

export type BulkAction = "publish" | "unpublish" | "delete";

interface Item {
  readonly id: string;
  readonly status: "draft" | "published";
}

/** Nur Produkte, die sich durch die Aktion ändern (schon sichtbare nicht noch einmal veröffentlichen). */
export function bulkTargets<T extends Item>(
  items: readonly T[],
  selected: ReadonlySet<string>,
  action: BulkAction,
): T[] {
  return items.filter(
    (p) =>
      selected.has(p.id) &&
      (action === "delete" || (action === "publish" ? p.status !== "published" : p.status === "published")),
  );
}

/** Kurzer Text nach der Aktion, etwa „3 Produkte sind jetzt im Shop.“ */
export function bulkMessage(action: BulkAction, done: number, failed: number): string {
  const n = (k: number) => (k === 1 ? "1 Produkt" : `${k} Produkte`);
  const ok =
    done === 0
      ? "Nichts zu ändern."
      : action === "publish"
        ? `${n(done)} ${done === 1 ? "ist" : "sind"} jetzt im Shop.`
        : action === "unpublish"
          ? `${n(done)} ${done === 1 ? "ist" : "sind"} jetzt Entwurf.`
          : `${n(done)} gelöscht.`;
  return failed === 0
    ? ok
    : `${ok} ${n(failed)} ging${failed === 1 ? "" : "en"} nicht, bitte einzeln versuchen.`;
}
