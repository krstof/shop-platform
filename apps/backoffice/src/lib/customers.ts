// Kundenliste im Backoffice: Suche im Browser (die Liste ist klein).

export interface CustomerSummary {
  readonly email: string;
  readonly name: string;
  readonly orderCount: number;
  readonly revenue: number;
  readonly firstOrderAt: string;
  readonly lastOrderAt: string;
}

/** Teiltreffer in Name oder E-Mail, ohne Groß-/Kleinschreibung; mehrere Wörter müssen alle passen. */
export function filterCustomers(list: readonly CustomerSummary[], text: string): CustomerSummary[] {
  const words = text
    .toLowerCase()
    .split(/\s+/)
    .filter((w) => w !== "");
  if (words.length === 0) return [...list];
  return list.filter((c) => {
    const hay = `${c.name} ${c.email}`.toLowerCase();
    return words.every((w) => hay.includes(w));
  });
}
