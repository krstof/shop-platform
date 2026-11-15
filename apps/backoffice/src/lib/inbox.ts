// Posteingang: Nachrichten aus dem Kontaktformular des Shops (API /admin/v1/contact-messages).

export interface ContactMessage {
  readonly id: string;
  readonly name: string;
  readonly email: string;
  readonly subject: string;
  readonly message: string;
  readonly read: boolean;
  readonly createdAt: string;
}

export const inboxKey = (shopId: string) => ["contact-messages", shopId] as const;

/** Betreff für die Liste und die Antwort-Mail; ohne Betreff der Anfang der Nachricht. */
export function messageTitle(m: Pick<ContactMessage, "subject" | "message">): string {
  if (m.subject.trim() !== "") return m.subject.trim();
  const first = m.message.trim().split("\n")[0] ?? "";
  return first.length > 60 ? `${first.slice(0, 57).trimEnd()} …` : first;
}

/** Link „Antworten“: öffnet das E-Mail-Programm mit Empfänger, „Re: Betreff“ und zitierter Nachricht. */
export function replyLink(m: ContactMessage, shopName: string): string {
  const subject = m.subject.trim() === "" ? `Deine Nachricht an ${shopName}` : `Re: ${m.subject.trim()}`;
  const quoted = m.message
    .split("\n")
    .map((l) => `> ${l}`)
    .join("\n");
  const body = `Hallo ${m.name},\n\n\n\n${m.name} schrieb:\n${quoted}`;
  return `mailto:${encodeURIComponent(m.email)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

/** „heute 14:05“, „gestern 09:12“ oder „12.11.2026, 18:30“ (deutsche Zeit). */
export function receivedAt(iso: string, now = new Date()): string {
  const d = new Date(iso);
  const day = (x: Date) => x.toLocaleDateString("de-DE", { timeZone: "Europe/Berlin" });
  const time = d.toLocaleTimeString("de-DE", {
    timeZone: "Europe/Berlin",
    hour: "2-digit",
    minute: "2-digit",
  });
  if (day(d) === day(now)) return `heute ${time}`;
  if (day(d) === day(new Date(now.getTime() - 86_400_000))) return `gestern ${time}`;
  return `${d.toLocaleDateString("de-DE", { timeZone: "Europe/Berlin", day: "2-digit", month: "2-digit", year: "numeric" })}, ${time}`;
}
