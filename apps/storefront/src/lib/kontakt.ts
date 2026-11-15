// Kontaktformular: Eingaben säubern und prüfen, bevor sie an die Storefront-API gehen.
// Dieselben Grenzen wie in der API (Name 100, Betreff 150, Nachricht 5000 Zeichen).

export const kontaktFelder = ["name", "email", "subject", "message"] as const;
export type KontaktFeld = (typeof kontaktFelder)[number];
export type KontaktWerte = Record<KontaktFeld, string>;

const GRENZE: Record<KontaktFeld, number> = { name: 100, email: 254, subject: 150, message: 5000 };

export function pruefeKontakt(roh: Record<string, string>): {
  ok: boolean;
  werte: KontaktWerte;
  fehler: Partial<Record<KontaktFeld, string>>;
} {
  const werte = Object.fromEntries(
    kontaktFelder.map((f) => {
      let v = (roh[f] ?? "").replace(/\r\n/g, "\n");
      v = f === "message" ? v : v.replace(/\s+/g, " ");
      return [f, v.trim().slice(0, GRENZE[f])];
    }),
  ) as KontaktWerte;
  const fehler: Partial<Record<KontaktFeld, string>> = {};
  if (werte.name === "") fehler.name = "Bitte deinen Namen angeben.";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(werte.email))
    fehler.email = "Bitte eine gültige E-Mail-Adresse angeben.";
  if (werte.message === "") fehler.message = "Bitte eine Nachricht schreiben.";
  return { ok: Object.keys(fehler).length === 0, werte, fehler };
}
