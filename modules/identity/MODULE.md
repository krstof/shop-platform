# Modul `identity`

> Landkarte für spätere Läufe (Architektur 8.4). Stand: E6 Teil 7 (09.11.2026), Abschnitte darunter je Teil.

**Aufgabe:** Anmeldung, Sitzungen, Zwei-Faktor, Mitgliedschaften und Rollen, API-Token. Anmeldedaten nur über die Rolle shop_auth (ADR-008).

**Welle:** 1

**Datenbankschema:** `identity`, Tabellen: `user`, `account`, `session`, `verification`, `two_factor`, `passkey`, `role`, `role_permission`, `membership`, `api_token`.
Datenbanktypen: `src/db.generated.ts` (erzeugt mit `pnpm db:types`, nie von Hand ändern).

**Darf aufrufen** (`module.json` → `dependsOn`): keine. Alles andere nur über Ereignisse.

**Fassade (heute):** `createIdentityService(options)` liefert `createUser`, `signIn`, `getSession`, `signOut`, `close`. Dazu `checkNewPassword` und die Konstanten zum Cookie und zur Sitzungsdauer.

**Fassade (geplant):** getActor(token) für API-Token, createApiToken(...), Einladungen, Zwei-Faktor zurücksetzen

**Aufbau innen** (`src/internal/`):
- `auth.ts`: Better Auth 1.7.14 (fest), nur E-Mail und Passwort, keine Selbst-Registrierung, keine Plugins, eingebaute Bremse aus, eigener Pool als `shop_auth`, Cookie `__Host-shop_session`, kein Sitzungs-Cache im Cookie.
- `hashed-session-adapter.ts`: Hülle um den Datenbank-Adapter, speichert Sitzungs-Token nur als SHA-256 (ADR-010).
- `password.ts`: Argon2id (19 MiB, 2 Durchläufe, Parallelität 1), Passwortregeln nach NIST, Liste häufiger Passwörter in `data/`.
- `identity-service.ts`: eigene Schnittstelle, damit niemand außerhalb Better Auth kennt. Höchstdauer der Sitzung (7 Tage) prüft sie selbst.

**Bewusst noch nicht da:** HTTP-Endpunkte (kommen mit der eigenen Bremse in Teil 2, vorher wäre Raten ungebremst möglich), Einladungen, Passwort vergessen, Zwei-Faktor, Mitgliedschaften, API-Token.

**Tests:** `src/identity.db.test.ts` (echte Datenbank, Rolle `shop_auth`), `password.test.ts`, `hashed-session-adapter.test.ts`.

**Ereignisse (geplant):** identity.user.registered.v1, identity.login.failed.v1, identity.membership.changed.v1

## Stand E6 Teil 2 (06.11.2026)

- Endpunkte der Auth-API (`src/http/auth.ts`): `POST /auth/v1/sign-in`, `POST /auth/v1/sign-out`, `GET /auth/v1/session`.
- Eigene Anmelde-Bremse (`src/internal/login-throttle.ts`): je Konto und je Netz, Sperre des Kontos in `identity.user.locked_until`.
- Der gebaute Code bringt die Liste bekannter Passwörter mit (`scripts/copy-data.mjs`).

## Stand E6 Teil 3 (07.11.2026)

- Systemrollen im Code (`src/internal/roles.ts`): `owner` bekommt alle Berechtigungen des Shops, `staff` die Liste `STAFF_SCOPES`. Nur für Inhaber (`OWNER_ONLY_SCOPES`) ist heute leer; Mitarbeiter, API-Token, Shop löschen und Zahlungseinstellungen kommen dort hinein, sobald es diese Berechtigungen gibt. `platform:*` bekommt keine Händlerrolle. `roles.test.ts` scheitert, wenn eine neue Berechtigung nicht eingeordnet ist.
- Mitgliedschaften (`src/internal/memberships.ts`): `createMembershipDirectory({ database })` mit `listMemberships(userId)` und `findMembership(userId, tenantId)`. Läuft als shop_app über `withUserTransaction` (RLS über `kernel.current_user_id()`). Zählt nur `status = 'active'`, Systemrollen und aktive Konten; eigene Rollen (`custom`) geben bis Welle 5 nichts.
- `authEndpoints(identity, { shopsOfUser })`: „Anmelden“ und „Wer bin ich“ liefern zusätzlich `shops` (id, handle, name, role). Die Funktion setzt `apps/api` zusammen (identity plus platform).
- Bewusst noch nicht da: Einladungen und Mitarbeiter entfernen, „Passwort vergessen“, Zwei-Faktor und Zugang des Betreibers zur Platform-API, API-Token, erneute Passworteingabe nach 15 Minuten.

## Stand E6 Teil 4 (07.11.2026)

- Zwei-Faktor nach TOTP ohne Better-Auth-Plugin (ADR-011): `src/internal/totp.ts` (RFC 6238, Ersatzcodes), Regeln für Sitzungen in `src/internal/session-rules.ts`.
- Fassade neu: `verifySecondFactor(cookie, code)`, `startTwoFactorSetup({ cookie, password, ipAddress })`, `confirmTwoFactorSetup(cookie, code)`. `signIn` meldet `secondFactorRequired`, `getSession` liefert `secondFactor` (`verified` oder `not_enrolled`) und nie eine wartende Sitzung.
- Pflicht-Option `secretBox` (Hauptschlüssel, `createSecretBox` aus dem kernel), optional `sessionKindOf(userId)` für die strengeren Betreiberregeln.
- Migration `20261107T090000_two_factor.sql`: `two_factor.last_used_step`, `session.two_factor_verified_at`, `session.two_factor_failures`, `session.last_seen_at`.
- Endpunkte: `POST /auth/v1/two-factor/verify`, `/setup`, `/enable`.
- Tests: `totp.test.ts`, `two-factor.db.test.ts`.
- Bewusst noch nicht da: Zwei-Faktor ausschalten oder zurücksetzen, neue Ersatzcodes erzeugen, Passkeys (Welle 2).

## Stand E6 Teil 5 (08.11.2026)

- API-Token (ADR-012): `createApiTokenService({ database, memberships? })` mit `authenticate(token)`, `create(...)`, `list(...)`, `revoke(...)` in `src/internal/api-tokens.ts`; Endpunkte `GET/POST /admin/v1/api-tokens`, `DELETE /admin/v1/api-tokens/{apiTokenId}` in `src/http/api-tokens.ts` (`apiTokenEndpoints`).
- Schnittmenge: Token-Berechtigungen ∩ aktuelle Rolle des Kontos (`issued_for_user_id`), nie `api_tokens:*` (`TOKEN_FORBIDDEN_SCOPES`, `TOKEN_SCOPES` in `roles.ts`). `api_tokens:*` stehen in `OWNER_ONLY_SCOPES`.
- Erneute Passworteingabe: `confirmPassword({ cookie, password, ipAddress })`, Endpunkt `POST /auth/v1/confirm-password`, Frist `REAUTHENTICATION_SECONDS` (15 Minuten). `ActiveSession.passwordConfirmedAt` (Anmeldung oder Bestätigung).
- Ereignisse: `identity.api_token.created.v1`, `identity.api_token.revoked.v1` (`src/identity.events.ts`).
- Migration `20261108T060000_api_tokens.sql`: Prüfregeln für Präfix, Hash, Name und Ablauf; `shop_app` darf nur `last_used_at` und `revoked_at` ändern und nichts löschen; `session.reauthenticated_at`.
- Tests: `api-tokens.test.ts`, `api-tokens.db.test.ts` (15 Fälle), in apps/api `api-tokens.db.test.ts` (9 Fälle Ende zu Ende).
- Bewusst noch nicht da: Token für KI (Welle 2) und Apps (Welle 4), Prüfsumme im Token für fremde Geheimnis-Scanner.

## Stand E6 Teil 6 (08.11.2026)

- „Passwort vergessen“ (ADR-013): Bausteine in `src/internal/password-reset.ts` (Code, Hash, Link, E-Mail-Text de/en, `ResetMailLimiter`), Ablauf in `identity-service.ts`.
- Fassade neu: `requestPasswordReset({ email })` liefert sofort `{ done }` (Hintergrund), `resetPassword({ code, newPassword })`. Option `mailer` (`MailSender`, setzt apps/api zusammen), für Tests `resetMailLimiter`.
- Endpunkte: `POST /auth/v1/password/forgot`, `POST /auth/v1/password/reset`.
- Migration `20261108T120000_password_reset.sql`: `verification.value_hash` eindeutig und 32 Byte, Ablauf nach Anlage.
- Tests: `password-reset.test.ts`, `password-reset.db.test.ts` (15 Fälle, u. a. einmalig auch gleichzeitig, Ablauf, Ersatz, Sperre aufheben, Zwei-Faktor bleibt), in apps/api `password-reset.db.test.ts` und `mail.test.ts`.
- Bewusst noch nicht da: Einladungen, Mitarbeiter entfernen (E6 Teil 7), Ereignis „Passwort geändert“ und Hinweis-E-Mail danach (mit notifications, E16).

## Stand E6 Teil 7 (09.11.2026)

- Mitarbeiter einladen und entfernen (ADR-014): `createMemberService({ database, identity, mailer?, baseUrl, shopName? })` in `src/internal/members.ts` mit `list`, `invite`, `remove`, `accept`; Bausteine (Kennung, Link, E-Mail-Text de/en, Grenzen) in `src/internal/invitations.ts`.
- `IdentityService` neu (nur für den MemberService): `prepareInvitee`, `issueInvitationCode`, `findInvitation`, `redeemInvitation`, `withdrawInvitation`. Eingeladene Konten haben bis zur Annahme kein Passwort.
- Endpunkte (`src/http/members.ts`, `memberEndpoints`): `GET/POST /admin/v1/members`, `DELETE /admin/v1/members/{memberId}`, `POST /auth/v1/invitations/accept`.
- Berechtigungen `members:read/write` nur für Inhaber (`OWNER_ONLY_SCOPES`) und nie für Token (`TOKEN_FORBIDDEN_SCOPES`).
- Ereignisse: `identity.member.invited.v1`, `.joined.v1`, `.removed.v1`.
- Migration `20261109T060000_invitations.sql`: Prüfregel für `membership.role_key`, Form des `identifier` bei Einladungen.
- Tests: `invitations.test.ts`, `members.db.test.ts` (15 Fälle), in apps/api `invitations.db.test.ts` (4 Fälle Ende zu Ende); T-08 und T-09 decken die neuen Endpunkte ab.
- Damit ist E6 fertig. Bewusst noch nicht da: Rolle ändern, Shop übergeben, Einladung vorab ansehen (Shopname für die Seite `/einladung`), Aufräumen nie angenommener Konten.
