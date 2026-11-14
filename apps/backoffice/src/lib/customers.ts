// Kundenliste im Backoffice: Suche im Browser (die Liste ist klein).

export interface CustomerSummary {
  readonly email: string;
  readonly name: string;
  readonly orderCount: number;
  readonly revenue: number;
  readonly firstOrderAt: string;
  readonly lastOrderAt: string;
}

/** Per Hand angelegte Kundenkarte (API /admin/v1/customer-profiles, 15.11.2026). */
export interface CustomerProfile {
  readonly id: string;
  readonly email: string;
  readonly firstName: string;
  readonly lastName: string;
  readonly phone: string;
  readonly address: { readonly street: string; readonly postalCode: string; readonly city: string } | null;
  readonly createdAt: string;
}

/** Eine Zeile der Kundenliste: Bestellungen (falls es welche gibt) und Kundenkarte (falls angelegt). */
export interface CustomerRow {
  readonly email: string;
  readonly name: string;
  readonly orderCount: number;
  readonly revenue: number;
  readonly lastOrderAt: string | null;
  readonly profile: CustomerProfile | null;
}

/** Führt Bestellende und angelegte Karten über die E-Mail zusammen; zuletzt aktive zuerst. */
export function mergeCustomers(
  summaries: readonly CustomerSummary[],
  profiles: readonly CustomerProfile[],
): CustomerRow[] {
  const byEmail = new Map(profiles.map((p) => [p.email.trim().toLowerCase(), p]));
  const rows: CustomerRow[] = summaries.map((s) => {
    const profile = byEmail.get(s.email.trim().toLowerCase()) ?? null;
    byEmail.delete(s.email.trim().toLowerCase());
    return {
      email: s.email,
      name: s.name || (profile ? `${profile.firstName} ${profile.lastName}`.trim() : ""),
      orderCount: s.orderCount,
      revenue: s.revenue,
      lastOrderAt: s.lastOrderAt,
      profile,
    };
  });
  for (const p of byEmail.values())
    rows.push({
      email: p.email,
      name: `${p.firstName} ${p.lastName}`.trim(),
      orderCount: 0,
      revenue: 0,
      lastOrderAt: null,
      profile: p,
    });
  const at = (r: CustomerRow) =>
    Math.max(Date.parse(r.lastOrderAt ?? "") || 0, Date.parse(r.profile?.createdAt ?? "") || 0);
  return rows.sort((a, b) => at(b) - at(a));
}

/** Teiltreffer in Name oder E-Mail, ohne Groß-/Kleinschreibung; mehrere Wörter müssen alle passen. */
export function filterCustomers<T extends { readonly name: string; readonly email: string }>(
  list: readonly T[],
  text: string,
): T[] {
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
