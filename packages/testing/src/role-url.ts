// Anmeldung als Anwendungsrolle in Tests, ohne deren Passwort zu ändern.
//
// Rollen und ihre Passwörter gelten für den ganzen PostgreSQL-Server, nicht für eine Datenbank.
// Laufen Tests mehrerer Pakete gleichzeitig gegen denselben Wegwerf-Server und setzt jeder ein
// eigenes Passwort für shop_app, scheitern die Anmeldungen der anderen (am 03.11.2026 so passiert).
// Stattdessen meldet sich der Test als Superuser an und wechselt sofort beim Verbindungsaufbau
// in die Rolle (`-c role=...`). Danach gelten genau die Rechte und RLS-Regeln dieser Rolle,
// die Superuser-Rechte sind für die Sitzung abgelegt.
const ROLE = /^shop_[a-z]+$/;

export function roleUrl(adminUrl: string, database: string, role: string): string {
  if (!ROLE.test(role)) throw new Error(`Unbekannte Rolle: ${role}`);
  const u = new URL(adminUrl);
  u.pathname = `/${database}`;
  u.searchParams.set("options", `-c role=${role}`);
  return u.href;
}
