// Endpunkte der Auth-API (E6 Teil 2, PLA-04, Sicherheit 5.2, ADR-010): Anmelden, Abmelden und
// „Wer bin ich“. Seit E6 Teil 3 nennen „Anmelden“ und „Wer bin ich“ auch die Shops des Kontos.
// Seit E6 Teil 4 (ADR-011) gibt es den zweiten Faktor: Code nach dem Passwort eingeben und
// Zwei-Faktor einrichten. Seit E6 Teil 6 „Passwort vergessen“ (ADR-013). Better Auth selbst bekommt keinen HTTP-Zugang; alle Endpunkte laufen wie
// alle anderen durch den Vertrag (Zod, OpenAPI, Anfragebremse, Herkunftsprüfung im Router).
import { defineEndpoint, type ClientInfo, type Endpoint } from "@shop/http";
import {
  ConflictError,
  InvalidCredentialsError,
  InvalidSecondFactorError,
  RateLimitedError,
  UnauthorizedError,
  ValidationError,
} from "@shop/kernel";
import { z } from "zod";
import type { ActiveSession, IdentityService } from "../internal/identity-service.js";
import { PASSWORD_RESET_PATH, PASSWORD_RESET_SECONDS } from "../internal/password-reset.js";
import { SYSTEM_ROLES, type SystemRole } from "../internal/roles.js";

/** Ein Shop, zu dem das Konto gehört, wie die Shop-Auswahl im Backoffice ihn zeigt. */
export interface ShopOfUser {
  readonly id: string;
  readonly handle: string;
  readonly name: string;
  readonly role: SystemRole;
}

export interface AuthEndpointOptions {
  /**
   * Shops des Kontos, in denen es gerade arbeiten darf (aktive Mitgliedschaft, Shop aktiv).
   * Setzt apps/api aus den Modulen identity und platform zusammen. Ohne Angabe: keine Shops.
   */
  readonly shopsOfUser?: (userId: string) => Promise<readonly ShopOfUser[]>;
  /**
   * Ist das Konto ein aktives Betreiberkonto (Plattform-Verwaltung, M8)? Setzt apps/api aus dem
   * Modul platform zusammen, weil identity platform nicht aufrufen darf. Ohne Angabe: nie.
   */
  readonly isPlatformOperator?: (userId: string) => Promise<boolean>;
}

const shopOfUserSchema = z
  .object({
    id: z.uuid().describe("Kennung des Shops. Als Kopfzeile Shop-Id an jede Anfrage der Admin-API hängen."),
    handle: z.string(),
    name: z.string(),
    role: z
      .enum(SYSTEM_ROLES)
      .describe("owner: Inhaberin oder Inhaber, staff: Mitarbeiterin oder Mitarbeiter."),
  })
  .meta({ id: "ShopOfUser" });

/** Eigene Sitzung, wie Backoffice und Plattform-Verwaltung sie anzeigen. Das Token steht nie darin. */
export const currentSessionSchema = z
  .object({
    user: z.object({ id: z.uuid(), email: z.string() }),
    session: z.object({
      id: z.uuid(),
      createdAt: z.iso.datetime({ offset: true }),
      expiresAt: z.iso
        .datetime({ offset: true })
        .describe(
          "Endet ohne Aktivität zu diesem Zeitpunkt; jede Anfrage schiebt ihn nach vorn (höchstens 7 Tage ab Anmeldung).",
        ),
      passwordConfirmedAt: z.iso
        .datetime({ offset: true })
        .describe(
          "Letzte Passworteingabe (Anmeldung oder POST /auth/v1/confirm-password). Kritische Aktionen " +
            "wie API-Token anlegen verlangen höchstens 15 Minuten; sonst vorher das Passwort bestätigen.",
        ),
    }),
    shops: z
      .array(shopOfUserSchema)
      .describe(
        "Shops, in denen das Konto arbeiten darf. Leer, solange es zu keinem aktiven Shop gehört " +
          "oder der zweite Faktor noch fehlt.",
      ),
    secondFactor: z
      .enum(["required", "verified", "not_enrolled"])
      .describe(
        "required: Passwort stimmt, jetzt den Code aus der Authenticator-App an " +
          "POST /auth/v1/two-factor/verify schicken (innerhalb von 10 Minuten); bis dahin gilt die " +
          "Sitzung nirgends. verified: zweiter Faktor bestätigt. not_enrolled: Konto ohne zweiten Faktor.",
      ),
    platformOperator: z
      .boolean()
      .describe(
        "true: aktives Betreiberkonto, die Platform-API steht offen. Ein zweiter Faktor ist dafür " +
          "nicht nötig (seit 22.11.2026); wer ihn eingerichtet hat, bestätigt ihn beim Anmelden. " +
          "Solange der Code einer Anmeldung fehlt, immer false.",
      ),
  })
  .meta({ id: "CurrentSession" });

const twoFactorSetupSchema = z
  .object({
    secret: z.string().describe("Geheimnis zum Abtippen in die App (Base32), falls kein QR-Code geht."),
    otpauthUri: z.string().describe("Inhalt des QR-Codes für die Authenticator-App."),
    backupCodes: z
      .array(z.string())
      .describe("10 Ersatzcodes, je einmal gültig. Werden nur jetzt gezeigt; sicher aufbewahren."),
  })
  .meta({ id: "TwoFactorSetup" });

const codeInput = z.strictObject({
  code: z
    .string()
    .min(1)
    .max(64)
    .describe("6 Ziffern aus der Authenticator-App oder ein Ersatzcode wie abcde-fghjk."),
});

/**
 * Anmeldedaten. Bewusst locker in Länge und Format: Eine ungültige E-Mail bekommt dieselbe
 * Antwort wie ein falsches Passwort (401), nicht 422, damit niemand Regeln oder Konten ertastet.
 * Die Obergrenzen schützen nur vor riesigen Eingaben.
 */
const signInInput = z.strictObject({
  email: z.string().min(1).max(320).describe("E-Mail-Adresse des Kontos (Groß- und Kleinschreibung egal)."),
  password: z.string().min(1).max(1024),
});

const signedOutSchema = z.object({ signedOut: z.literal(true) }).meta({ id: "SignedOut" });

const passwordResetRequestedSchema = z
  .object({
    accepted: z
      .literal(true)
      .describe("Immer true, auch wenn es die E-Mail-Adresse nicht gibt. Die Antwort verrät nichts."),
  })
  .meta({ id: "PasswordResetRequested" });

const passwordChangedSchema = z.object({ passwordChanged: z.literal(true) }).meta({ id: "PasswordChanged" });

function requireClient(client: ClientInfo | undefined): ClientInfo {
  // Der Router setzt client für jeden Endpunkt der Auth-API; fehlt er, ist das ein Programmfehler.
  if (client === undefined) throw new Error("Auth-Endpunkt ohne Angaben zum Aufrufer");
  return client;
}

function iso(d: Date): string {
  return d.toISOString();
}

function sessionBody(s: ActiveSession) {
  return {
    id: s.sessionId,
    createdAt: iso(s.createdAt),
    expiresAt: iso(s.expiresAt),
    passwordConfirmedAt: iso(s.passwordConfirmedAt),
  };
}

export function authEndpoints(identity: IdentityService, options: AuthEndpointOptions = {}): Endpoint[] {
  const shopsOf = async (userId: string) => [...((await options.shopsOfUser?.(userId)) ?? [])];
  const operatorOf = async (userId: string) => (await options.isPlatformOperator?.(userId)) ?? false;

  const signIn = defineEndpoint({
    api: "auth",
    method: "POST",
    path: "/sign-in",
    operationId: "signIn",
    summary: "Anmelden",
    description:
      "Meldet mit E-Mail und Passwort an und setzt das Sitzungs-Cookie __Host-shop_session " +
      "(HttpOnly, Secure, SameSite=Lax). Eine schon vorhandene Sitzung dieses Browsers wird beendet. " +
      "Unbekannte E-Mail und falsches Passwort ergeben dieselbe Antwort. Nach 5 Fehlversuchen je Konto " +
      "oder Netz kommt 429 mit wachsender Wartezeit (höchstens 60 s), nach 20 wird das Konto 15 Minuten gesperrt. " +
      "Hat das Konto Zwei-Faktor, steht in der Antwort secondFactor: required; die Sitzung gilt dann erst nach " +
      "POST /auth/v1/two-factor/verify.",
    tags: ["Anmeldung"],
    access: { public: true, reason: "Wer sich anmeldet, hat noch keine Sitzung." },
    body: signInInput,
    bodyExample: { email: "inhaberin@teeladen.example", password: "drei kleine teekannen" },
    idempotency: "none",
    response: {
      status: 200,
      description: "Angemeldet. Das Cookie steht in Set-Cookie.",
      schema: currentSessionSchema,
    },
    problems: [401, 429],
    handler: async ({ body, client, setCookie }) => {
      const c = requireClient(client);
      const result = await identity.signIn({
        email: body.email,
        password: body.password,
        ipAddress: c.ip,
        ...(c.userAgent === undefined ? {} : { userAgent: c.userAgent }),
      });
      if (!result.ok) {
        if (result.reason === "throttled")
          throw new RateLimitedError({ retryAfterSeconds: result.retryAfterSeconds });
        throw new InvalidCredentialsError();
      }
      // Neue Sitzungs-ID bei jeder Anmeldung; die alte Sitzung dieses Browsers gilt nicht weiter.
      await identity.signOut(c.cookie);
      setCookie(result.setCookie);
      return {
        user: { id: result.userId, email: result.email },
        session: {
          id: result.sessionId,
          createdAt: iso(result.createdAt),
          expiresAt: iso(result.expiresAt),
          passwordConfirmedAt: iso(result.createdAt),
        },
        // Vor dem zweiten Faktor verrät die Antwort keine Shops.
        shops: result.secondFactorRequired ? [] : await shopsOf(result.userId),
        secondFactor: result.secondFactorRequired ? ("required" as const) : ("not_enrolled" as const),
        platformOperator: result.secondFactorRequired ? false : await operatorOf(result.userId),
      };
    },
  });

  const signOut = defineEndpoint({
    api: "auth",
    method: "POST",
    path: "/sign-out",
    operationId: "signOut",
    summary: "Abmelden",
    description:
      "Beendet die Sitzung dieses Browsers in der Datenbank und löscht das Cookie. Klappt auch, " +
      "wenn die Sitzung schon abgelaufen ist; die Antwort ist dann dieselbe.",
    tags: ["Anmeldung"],
    access: {
      public: true,
      reason: "Abmelden muss auch mit abgelaufener Sitzung gehen, damit das Cookie sicher verschwindet.",
    },
    idempotency: "none",
    // Abmelden verrät nichts und lässt sich nicht erraten: nicht unter die strenge Anmelde-Bremse
    // (5 je Minute und Netz), sonst bliebe man nach ein paar Versuchen angemeldet (M3).
    rateLimit: "admin",
    response: {
      status: 200,
      description: "Abgemeldet. Set-Cookie löscht das Cookie.",
      schema: signedOutSchema,
    },
    handler: async ({ client, setCookie }) => {
      const { clearCookie } = await identity.signOut(requireClient(client).cookie);
      setCookie(clearCookie);
      return { signedOut: true as const };
    },
  });

  const current = defineEndpoint({
    api: "auth",
    method: "GET",
    path: "/session",
    operationId: "getCurrentSession",
    summary: "Wer bin ich",
    description:
      "Liefert das angemeldete Konto, die laufende Sitzung und die Shops, in denen das Konto arbeiten darf. " +
      "Ohne gültige Sitzung 401.",
    tags: ["Anmeldung"],
    access: { signedIn: true },
    response: { status: 200, description: "Konto, Sitzung und Shops.", schema: currentSessionSchema },
    handler: async ({ client }) => {
      const s = await identity.getSession(requireClient(client).cookie);
      if (s === undefined) throw new UnauthorizedError();
      return {
        user: { id: s.userId, email: s.email },
        session: sessionBody(s),
        shops: await shopsOf(s.userId),
        secondFactor: s.secondFactor,
        platformOperator: await operatorOf(s.userId),
      };
    },
  });

  const verifySecondFactor = defineEndpoint({
    api: "auth",
    method: "POST",
    path: "/two-factor/verify",
    operationId: "verifySecondFactor",
    summary: "Zweiten Faktor eingeben",
    description:
      "Zweiter Schritt der Anmeldung für Konten mit Zwei-Faktor: Code aus der Authenticator-App " +
      "(6 Ziffern, jeder Code gilt nur einmal) oder ein Ersatzcode. Danach gilt die Sitzung. " +
      "Nach 5 falschen Codes ist die Sitzung beendet und die Anmeldung beginnt mit dem Passwort neu. " +
      "Falsche, schon benutzte und abgelaufene Codes ergeben dieselbe Antwort.",
    tags: ["Anmeldung"],
    access: {
      public: true,
      reason: "Die Sitzung wartet noch auf den zweiten Faktor und gilt deshalb noch nicht als angemeldet.",
    },
    body: codeInput,
    bodyExample: { code: "123456" },
    idempotency: "none",
    response: { status: 200, description: "Bestätigt. Die Sitzung gilt.", schema: currentSessionSchema },
    problems: [401, 409, 429],
    handler: async ({ body, client }) => {
      const result = await identity.verifySecondFactor(requireClient(client).cookie, body.code);
      if (!result.ok) {
        if (result.reason === "not_pending")
          throw new ConflictError({ detail: "Diese Sitzung braucht keinen Code." });
        if (result.reason === "no_session")
          throw new UnauthorizedError({ detail: "Bitte zuerst mit E-Mail und Passwort anmelden." });
        throw new InvalidSecondFactorError();
      }
      const s = result.session;
      return {
        user: { id: s.userId, email: s.email },
        session: sessionBody(s),
        shops: await shopsOf(s.userId),
        secondFactor: s.secondFactor,
        platformOperator: await operatorOf(s.userId),
      };
    },
  });

  const startSetup = defineEndpoint({
    api: "auth",
    method: "POST",
    path: "/two-factor/setup",
    operationId: "startTwoFactorSetup",
    summary: "Zwei-Faktor einrichten (Schritt 1)",
    description:
      "Prüft das Passwort erneut und erzeugt ein neues Geheimnis für die Authenticator-App samt " +
      "10 Ersatzcodes. Zwei-Faktor ist danach noch aus; erst POST /auth/v1/two-factor/enable mit " +
      "einem Code aus der App schaltet es ein (innerhalb von 15 Minuten). Ist Zwei-Faktor schon an, 409.",
    tags: ["Anmeldung"],
    access: { signedIn: true },
    body: z.strictObject({
      password: z.string().min(1).max(1024).describe("Aktuelles Passwort des Kontos."),
    }),
    bodyExample: { password: "drei kleine teekannen" },
    idempotency: "none",
    response: {
      status: 200,
      description: "Geheimnis und Ersatzcodes. Nur in dieser Antwort sichtbar.",
      schema: twoFactorSetupSchema,
    },
    problems: [401, 409, 429],
    handler: async ({ body, client }) => {
      const c = requireClient(client);
      const result = await identity.startTwoFactorSetup({
        cookie: c.cookie,
        password: body.password,
        ipAddress: c.ip,
      });
      if (!result.ok) {
        if (result.reason === "throttled")
          throw new RateLimitedError({ retryAfterSeconds: result.retryAfterSeconds });
        if (result.reason === "already_enabled")
          throw new ConflictError({ detail: "Zwei-Faktor ist für dieses Konto schon eingeschaltet." });
        if (result.reason === "no_session") throw new UnauthorizedError();
        throw new InvalidCredentialsError({ detail: "Das Passwort ist falsch." });
      }
      return { ...result.setup, backupCodes: [...result.setup.backupCodes] };
    },
  });

  const enable = defineEndpoint({
    api: "auth",
    method: "POST",
    path: "/two-factor/enable",
    operationId: "enableTwoFactor",
    summary: "Zwei-Faktor einrichten (Schritt 2)",
    description:
      "Schaltet Zwei-Faktor mit einem ersten Code aus der App ein. Diese Sitzung gilt danach als " +
      "bestätigt, alle anderen Sitzungen des Kontos werden beendet. Falscher Code: 422; nach 5 falschen " +
      "Codes ist die Sitzung beendet.",
    tags: ["Anmeldung"],
    access: { signedIn: true },
    body: codeInput,
    bodyExample: { code: "123456" },
    idempotency: "none",
    response: { status: 200, description: "Zwei-Faktor ist eingeschaltet.", schema: currentSessionSchema },
    problems: [401, 409, 429],
    handler: async ({ body, client, locale }) => {
      const result = await identity.confirmTwoFactorSetup(requireClient(client).cookie, body.code);
      if (!result.ok) {
        if (result.reason === "already_enabled")
          throw new ConflictError({ detail: "Zwei-Faktor ist für dieses Konto schon eingeschaltet." });
        if (result.reason === "no_setup")
          throw new ConflictError({
            detail: "Keine begonnene Einrichtung (oder älter als 15 Minuten). Bitte neu beginnen.",
          });
        if (result.reason === "no_session") throw new UnauthorizedError();
        const message =
          locale === "en" ? "The code is wrong or has expired." : "Der Code ist falsch oder abgelaufen.";
        throw new ValidationError({ errors: [{ path: "/body/code", code: "invalid_code", message }] });
      }
      const s = result.session;
      return {
        user: { id: s.userId, email: s.email },
        session: sessionBody(s),
        shops: await shopsOf(s.userId),
        secondFactor: s.secondFactor,
        platformOperator: await operatorOf(s.userId),
      };
    },
  });

  const confirmPassword = defineEndpoint({
    api: "auth",
    method: "POST",
    path: "/confirm-password",
    operationId: "confirmPassword",
    summary: "Passwort bestätigen",
    description:
      "Prüft das Passwort der laufenden Sitzung erneut, ohne neu anzumelden. Danach sind 15 Minuten " +
      "lang kritische Aktionen erlaubt, etwa API-Token anlegen (Antwort 403 reauthentication_required " +
      "heißt: zuerst hier bestätigen). Falsches Passwort zählt wie ein Fehlversuch bei der Anmeldung " +
      "(Bremse, nach 20 Fehlversuchen Sperre des Kontos).",
    tags: ["Anmeldung"],
    access: { signedIn: true },
    body: z.strictObject({
      password: z.string().min(1).max(1024).describe("Aktuelles Passwort des Kontos."),
    }),
    bodyExample: { password: "drei kleine teekannen" },
    idempotency: "none",
    response: {
      status: 200,
      description: "Bestätigt. Die Sitzung nennt die neue Zeit.",
      schema: currentSessionSchema,
    },
    problems: [401, 429],
    handler: async ({ body, client }) => {
      const c = requireClient(client);
      const result = await identity.confirmPassword({
        cookie: c.cookie,
        password: body.password,
        ipAddress: c.ip,
      });
      if (!result.ok) {
        if (result.reason === "throttled")
          throw new RateLimitedError({ retryAfterSeconds: result.retryAfterSeconds });
        if (result.reason === "no_session") throw new UnauthorizedError();
        throw new InvalidCredentialsError({ detail: "Das Passwort ist falsch." });
      }
      const s = result.session;
      return {
        user: { id: s.userId, email: s.email },
        session: sessionBody(s),
        shops: await shopsOf(s.userId),
        secondFactor: s.secondFactor,
        platformOperator: await operatorOf(s.userId),
      };
    },
  });

  const forgotPassword = defineEndpoint({
    api: "auth",
    method: "POST",
    path: "/password/forgot",
    operationId: "requestPasswordReset",
    summary: "Passwort vergessen",
    description:
      "Schickt einen Link zum Zurücksetzen an die E-Mail-Adresse, falls es dazu ein aktives Konto gibt. " +
      "Die Antwort ist immer dieselbe und kommt sofort, damit niemand so herausfindet, welche Adressen " +
      `ein Konto haben. Der Link führt ins Backoffice (${PASSWORD_RESET_PATH}#code=…), gilt ` +
      `${PASSWORD_RESET_SECONDS / 60} Minuten und nur einmal; ein neuer Link macht den alten ungültig. ` +
      "Höchstens 3 E-Mails je Konto in 15 Minuten, weitere Anfragen verschicken still nichts.",
    tags: ["Anmeldung"],
    access: { public: true, reason: "Wer sein Passwort vergessen hat, kann sich nicht anmelden." },
    body: z.strictObject({
      email: z
        .string()
        .min(1)
        .max(320)
        .describe("E-Mail-Adresse des Kontos (Groß- und Kleinschreibung egal)."),
    }),
    bodyExample: { email: "inhaberin@teeladen.example" },
    idempotency: "none",
    response: {
      status: 200,
      description: "Angenommen. Gibt es das Konto, ist die E-Mail unterwegs.",
      schema: passwordResetRequestedSchema,
    },
    problems: [429],
    handler: async ({ body }) => {
      // Nicht auf den Hintergrund warten: Sonst dauert die Antwort bei bekannten Adressen länger.
      identity.requestPasswordReset({ email: body.email });
      return { accepted: true as const };
    },
  });

  const resetPassword = defineEndpoint({
    api: "auth",
    method: "POST",
    path: "/password/reset",
    operationId: "resetPassword",
    summary: "Neues Passwort setzen",
    description:
      "Setzt mit dem Code aus dem Link ein neues Passwort. Meldet nicht an: Danach ganz normal anmelden " +
      "(mit Zwei-Faktor wie gewohnt). Alle Sitzungen des Kontos werden beendet, eine Sperre nach " +
      "Fehlversuchen fällt weg. Unbekannter, benutzter oder abgelaufener Code: 422 mit invalid_reset_code. " +
      "Erfüllt das Passwort die Regeln nicht (mindestens 12 Zeichen, nicht zu bekannt, ohne die E-Mail), " +
      "kommt 422 und der Code bleibt gültig.",
    tags: ["Anmeldung"],
    access: { public: true, reason: "Wer sein Passwort vergessen hat, kann sich nicht anmelden." },
    body: z.strictObject({
      code: z.string().min(1).max(128).describe("Code aus dem Link in der E-Mail (der Teil nach #code=)."),
      newPassword: z.string().min(1).max(1024).describe("Das neue Passwort."),
    }),
    bodyExample: {
      code: "q3v8yQ0lRk2c5wP1bT9mN4xZ7hJ6sD0aF8gK2eL5uIo",
      newPassword: "vier kleine teekannen",
    },
    idempotency: "none",
    response: { status: 200, description: "Das Passwort ist geändert.", schema: passwordChangedSchema },
    handler: async ({ body, locale }) => {
      const result = await identity.resetPassword({ code: body.code, newPassword: body.newPassword });
      if (result.ok) return { passwordChanged: true as const };
      if (result.reason === "weak_password")
        throw new ValidationError({
          errors: [
            { path: "/body/newPassword", code: `password_${result.problem}`, message: result.message },
          ],
        });
      const message =
        locale === "en"
          ? "The link is invalid, has already been used or has expired. Please request a new one."
          : "Der Link ist ungültig, schon benutzt oder abgelaufen. Bitte einen neuen anfordern.";
      throw new ValidationError({ errors: [{ path: "/body/code", code: "invalid_reset_code", message }] });
    },
  });

  return [
    signIn,
    signOut,
    current,
    verifySecondFactor,
    startSetup,
    enable,
    confirmPassword,
    forgotPassword,
    resetPassword,
  ];
}
