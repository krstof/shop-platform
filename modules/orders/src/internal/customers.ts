// Kundinnen aus Bestellungen (Gäste haben kein Konto): je E-Mail-Adresse zusammengefasst.

export interface CustomerOrderRow {
  readonly email: string;
  readonly firstName: string | null;
  readonly lastName: string | null;
  readonly total: number;
  readonly status: string;
  readonly paymentStatus: string;
  readonly placedAt: Date;
}

export interface CustomerSummary {
  readonly email: string;
  /** Name aus der neuesten Bestellung. */
  readonly name: string;
  /** Bestellungen ohne stornierte. */
  readonly orderCount: number;
  /** Summe der bezahlten Bestellungen in Cent. */
  readonly revenue: number;
  readonly firstOrderAt: Date;
  readonly lastOrderAt: Date;
}

/** Fasst Bestellungen je E-Mail (ohne Groß-/Kleinschreibung) zusammen, zuletzt bestellende zuerst. */
export function summarizeCustomers(rows: readonly CustomerOrderRow[]): CustomerSummary[] {
  const byEmail = new Map<string, { s: CustomerSummary; lastAt: number }>();
  for (const r of rows) {
    const key = r.email.trim().toLowerCase();
    if (key === "") continue;
    const at = r.placedAt.getTime();
    const name = `${r.firstName ?? ""} ${r.lastName ?? ""}`.trim();
    const counts = r.status !== "cancelled";
    const paid = r.paymentStatus === "paid" ? r.total : 0;
    const prev = byEmail.get(key);
    if (prev === undefined) {
      byEmail.set(key, {
        s: {
          email: r.email.trim(),
          name,
          orderCount: counts ? 1 : 0,
          revenue: paid,
          firstOrderAt: r.placedAt,
          lastOrderAt: r.placedAt,
        },
        lastAt: at,
      });
      continue;
    }
    const newer = at > prev.lastAt;
    byEmail.set(key, {
      s: {
        email: newer ? r.email.trim() : prev.s.email,
        name: newer && name !== "" ? name : prev.s.name,
        orderCount: prev.s.orderCount + (counts ? 1 : 0),
        revenue: prev.s.revenue + paid,
        firstOrderAt: at < prev.s.firstOrderAt.getTime() ? r.placedAt : prev.s.firstOrderAt,
        lastOrderAt: newer ? r.placedAt : prev.s.lastOrderAt,
      },
      lastAt: Math.max(at, prev.lastAt),
    });
  }
  return [...byEmail.values()]
    .map((v) => v.s)
    .sort((a, b) => b.lastOrderAt.getTime() - a.lastOrderAt.getTime());
}
