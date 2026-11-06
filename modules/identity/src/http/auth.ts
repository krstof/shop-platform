// Endpunkte der Auth-API (E6 Teil 2, PLA-04, Sicherheit 5.2, ADR-010): Anmelden, Abmelden und
// „Wer bin ich“. Better Auth selbst bekommt keinen HTTP-Zugang; diese drei Endpunkte laufen wie
// alle anderen durch den Vertrag (Zod, OpenAPI, Anfragebremse, Herkunftsprüfung im Router).
import { defineEndpoint, type ClientInfo, type Endpoint } from "@shop/http";
import { InvalidCredentialsError, RateLimitedError, UnauthorizedError } from "@shop/kernel";
import { z } from "zod";
import type { IdentityService } from "../internal/identity-service.js";

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
    }),
  })
  .meta({ id: "CurrentSession" });

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

function requireClient(client: ClientInfo | undefined): ClientInfo {
  // Der Router setzt client für jeden Endpunkt der Auth-API; fehlt er, ist das ein Programmfehler.
  if (client === undefined) throw new Error("Auth-Endpunkt ohne Angaben zum Aufrufer");
  return client;
}

function iso(d: Date): string {
  return d.toISOString();
}

export function authEndpoints(identity: IdentityService): Endpoint[] {
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
      "oder Netz kommt 429 mit wachsender Wartezeit, nach 20 eine Sperre von 15 Minuten.",
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
        session: { id: result.sessionId, createdAt: iso(result.createdAt), expiresAt: iso(result.expiresAt) },
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
    description: "Liefert das angemeldete Konto und die laufende Sitzung. Ohne gültige Sitzung 401.",
    tags: ["Anmeldung"],
    access: { signedIn: true },
    response: { status: 200, description: "Konto und Sitzung.", schema: currentSessionSchema },
    handler: async ({ client }) => {
      const s = await identity.getSession(requireClient(client).cookie);
      if (s === undefined) throw new UnauthorizedError();
      return {
        user: { id: s.userId, email: s.email },
        session: { id: s.sessionId, createdAt: iso(s.createdAt), expiresAt: iso(s.expiresAt) },
      };
    },
  });

  return [signIn, signOut, current];
}
