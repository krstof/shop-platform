// Team-Seite im Backoffice: Texte zu Rolle und Status eines Mitglieds (API /admin/v1/members).

export interface Member {
  readonly id: string;
  readonly userId: string;
  readonly email: string;
  readonly name: string | null;
  readonly role: "owner" | "staff" | "custom";
  readonly status: "invited" | "active" | "disabled";
  readonly createdAt: string;
}

export interface InvitedMember extends Member {
  readonly invitationSent: boolean;
  readonly invitationExpiresAt: string;
}

export function roleLabel(role: Member["role"]): string {
  return role === "owner" ? "Inhaber:in" : role === "staff" ? "Mitarbeiter:in" : "Eigene Rolle";
}

export function statusLabel(status: Member["status"]): { text: string; tone: "green" | "amber" | "stone" } {
  if (status === "active") return { text: "Aktiv", tone: "green" };
  if (status === "invited") return { text: "Eingeladen", tone: "amber" };
  return { text: "Deaktiviert", tone: "stone" };
}

/** Inhaber:in zuerst, dann aktive, dann eingeladene; innerhalb nach E-Mail. */
export function sortMembers(list: readonly Member[]): Member[] {
  const rank = (m: Member) =>
    m.role === "owner" ? 0 : m.status === "active" ? 1 : m.status === "invited" ? 2 : 3;
  return [...list].sort((a, b) => rank(a) - rank(b) || a.email.localeCompare(b.email, "de"));
}

/** Grobe Prüfung im Browser; die API prüft genau. */
export function looksLikeEmail(text: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text.trim());
}
