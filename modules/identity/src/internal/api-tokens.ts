// API-Token für Skripte, später KI und Apps (E6 Teil 5, Sicherheit 5.2 und 5.3, Architektur 4.4).
//
// - Form: `shp_at_` + 43 Zeichen Base64url (32 Byte Zufall). Das Präfix erkennt gitleaks
//   (.gitleaks.toml), falls ein Token versehentlich in Code landet.
// - Gespeichert wird nur der SHA-256-Wert des ganzen Tokens und die ersten 4 Zeichen nach dem
//   Präfix zum Wiedererkennen. Das Token selbst sieht man genau einmal: beim Anlegen.
// - Jedes Token gehört zu genau einem Shop und gilt im Namen des Kontos, das es angelegt hat.
//   Es darf nur, was das Token erlaubt UND was dieses Konto im Shop gerade darf (Schnittmenge).
//   Verliert das Konto die Mitgliedschaft oder wird gesperrt, gilt das Token sofort nicht mehr.
// - Läuft als shop_app. Vor der Shop-Auswahl sieht die RLS-Regel nur die eine Zeile, deren Hash
//   in `app.api_token_hash` steht (withApiTokenTransaction).
import { createHash, randomBytes } from "node:crypto";
import { isScope, type Scope } from "@shop/http";
import {
  isUuid,
  publishEvent,
  withApiTokenTransaction,
  withTenantTransaction,
  type Database,
  type Transaction,
} from "@shop/kernel";
import type { DB } from "../db.generated.js";
import { apiTokenCreated, apiTokenRevoked } from "../identity.events.js";
import { createMembershipDirectory, type MembershipDirectory } from "./memberships.js";
import { scopesForRole, TOKEN_FORBIDDEN_SCOPES, TOKEN_SCOPES } from "./roles.js";

export const API_TOKEN_PREFIX = "shp_at_";
/** Vollständiges Token: Präfix und 43 Zeichen Base64url (32 Byte). */
export const API_TOKEN_PATTERN = /^shp_at_[A-Za-z0-9_-]{43}$/;
/** Höchstens so viele gültige (nicht widerrufene, nicht abgelaufene) Token je Shop. */
export const MAX_ACTIVE_TOKENS_PER_SHOP = 25;
/** Ein Ablaufdatum muss mindestens so weit in der Zukunft liegen. */
export const MIN_LIFETIME_SECONDS = 60;
/** „Zuletzt benutzt“ wird höchstens einmal je Minute geschrieben. */
export const LAST_USED_RESOLUTION_SECONDS = 60;

export interface NewApiToken {
  /** Klartext. Nur zum einmaligen Anzeigen, nie speichern oder protokollieren. */
  readonly token: string;
  readonly prefix: string;
  readonly hash: Buffer;
}

/** Erzeugt ein neues Token. */
export function generateApiToken(): NewApiToken {
  const token = API_TOKEN_PREFIX + randomBytes(32).toString("base64url");
  return { token, prefix: token.slice(0, API_TOKEN_PREFIX.length + 4), hash: hashApiToken(token) };
}

export function hashApiToken(token: string): Buffer {
  return createHash("sha256").update(token, "utf8").digest();
}

export type ApiTokenStatus = "active" | "expired" | "revoked";

export interface ApiTokenRecord {
  readonly id: string;
  readonly name: string;
  readonly prefix: string;
  readonly scopes: readonly Scope[];
  readonly issuedForUserId: string | null;
  readonly expiresAt: Date | null;
  readonly lastUsedAt: Date | null;
  readonly revokedAt: Date | null;
  readonly createdAt: Date;
  readonly status: ApiTokenStatus;
}

/** Ergebnis der Prüfung eines Tokens: Shop und Berechtigungen nach der Schnittmenge. */
export interface AuthenticatedApiToken {
  readonly tokenId: string;
  readonly tenantId: string;
  readonly scopes: ReadonlySet<Scope>;
}

export interface CreateApiTokenInput {
  readonly tenantId: string;
  /** Konto, in dessen Namen das Token gilt. */
  readonly userId: string;
  readonly name: string;
  readonly scopes: readonly Scope[];
  readonly expiresAt?: Date | undefined;
}

export type CreateApiTokenResult =
  | { readonly ok: true; readonly token: string; readonly record: ApiTokenRecord }
  | {
      readonly ok: false;
      /** `scope_not_allowed`: Berechtigung, die das Konto selbst nicht hat oder ein Token nie bekommt. */
      readonly reason: "scope_not_allowed";
      readonly scopes: readonly string[];
    }
  | { readonly ok: false; readonly reason: "expiry_in_past" | "too_many_tokens" };

export interface ApiTokenService {
  /** Prüft ein Token aus `Authorization: Bearer …`. `undefined`: ungültig, widerrufen, abgelaufen oder ohne Rechte. */
  authenticate(token: string): Promise<AuthenticatedApiToken | undefined>;
  /** Legt ein Token an. Läuft im Shop des Anfrage-Kontexts; schreibt das Ereignis in dieselbe Transaktion. */
  create(input: CreateApiTokenInput): Promise<CreateApiTokenResult>;
  /** Token des Shops, neueste zuerst, seitenweise (`beforeId`: Cursor). */
  list(
    tenantId: string,
    options: { readonly limit: number; readonly beforeId?: string },
  ): Promise<ApiTokenRecord[]>;
  /** Widerruft ein Token des Shops. Schon widerrufen: unverändert. Fremd oder unbekannt: `undefined`. */
  revoke(tenantId: string, id: string): Promise<ApiTokenRecord | undefined>;
}

export interface ApiTokenServiceOptions {
  /** Verbindung als Rolle shop_app. */
  readonly database: Database<unknown>;
  /** Standard: Mitgliedschaften aus derselben Datenbank. */
  readonly memberships?: Pick<MembershipDirectory, "findMembership">;
  /** Nur für Tests. */
  readonly now?: () => number;
}

const COLUMNS = [
  "id",
  "name",
  "token_prefix",
  "scopes",
  "issued_for_user_id",
  "expires_at",
  "last_used_at",
  "revoked_at",
  "created_at",
] as const;

interface TokenRow {
  id: string;
  name: string;
  token_prefix: string;
  scopes: string[];
  issued_for_user_id: string | null;
  expires_at: Date | null;
  last_used_at: Date | null;
  revoked_at: Date | null;
  created_at: Date;
}

function knownScopes(scopes: readonly string[]): Scope[] {
  return scopes.filter((s): s is Scope => (TOKEN_SCOPES as readonly string[]).includes(s));
}

export function createApiTokenService(options: ApiTokenServiceOptions): ApiTokenService {
  const database = options.database as Database<DB>;
  const memberships = options.memberships ?? createMembershipDirectory({ database: options.database });
  const now = options.now ?? Date.now;

  const statusOf = (r: TokenRow): ApiTokenStatus =>
    r.revoked_at !== null
      ? "revoked"
      : r.expires_at !== null && r.expires_at.getTime() <= now()
        ? "expired"
        : "active";

  const toRecord = (r: TokenRow): ApiTokenRecord => ({
    id: r.id,
    name: r.name,
    prefix: r.token_prefix,
    scopes: knownScopes(r.scopes),
    issuedForUserId: r.issued_for_user_id,
    expiresAt: r.expires_at,
    lastUsedAt: r.last_used_at,
    revokedAt: r.revoked_at,
    createdAt: r.created_at,
    status: statusOf(r),
  });

  const findById = (trx: Transaction<DB>, id: string) =>
    trx.selectFrom("identity.api_token").select(COLUMNS).where("id", "=", id).executeTakeFirst();

  return {
    async authenticate(token) {
      if (!API_TOKEN_PATTERN.test(token)) return undefined;
      const hash = hashApiToken(token);
      const row = await withApiTokenTransaction(database, hash, (trx) =>
        trx
          .selectFrom("identity.api_token")
          .select([
            "id",
            "tenant_id",
            "scopes",
            "issued_for_user_id",
            "expires_at",
            "last_used_at",
            "revoked_at",
          ])
          // Doppelt gesichert: Die RLS-Regel zeigt ohnehin nur diese eine Zeile.
          .where("token_hash", "=", hash)
          .executeTakeFirst(),
      );
      if (row === undefined || row.revoked_at !== null) return undefined;
      if (row.expires_at !== null && row.expires_at.getTime() <= now()) return undefined;
      // Ohne Konto dahinter (erst für KI-Token ab Welle 2 denkbar) gilt das Token nicht.
      if (row.issued_for_user_id === null) return undefined;
      const membership = await memberships.findMembership(row.issued_for_user_id, row.tenant_id);
      if (membership === undefined) return undefined;
      // Zwei Schranken, beide geschlossen: was die Rolle des Kontos gerade erlaubt, und nie die
      // Verwaltung von Token. Auch ein in der Datenbank nachträglich erweitertes Token bekommt nicht mehr.
      const allowed = scopesForRole(membership.role);
      const scopes = new Set(
        row.scopes.filter(isScope).filter((s) => allowed.has(s) && !TOKEN_FORBIDDEN_SCOPES.includes(s)),
      );
      if (scopes.size === 0) return undefined;

      const lastUsed = row.last_used_at?.getTime() ?? 0;
      if (now() - lastUsed > LAST_USED_RESOLUTION_SECONDS * 1000) {
        await withTenantTransaction(
          database,
          (trx) =>
            trx
              .updateTable("identity.api_token")
              .set({ last_used_at: new Date(now()) })
              .where("id", "=", row.id)
              .execute(),
          { tenantId: row.tenant_id, actorId: row.id },
        );
      }
      return { tokenId: row.id, tenantId: row.tenant_id, scopes };
    },

    async create(input) {
      // Nur Berechtigungen, die ein Token überhaupt tragen kann UND die das Konto selbst hat.
      const membership = await memberships.findMembership(input.userId, input.tenantId);
      const own = membership === undefined ? new Set<Scope>() : scopesForRole(membership.role);
      const notAllowed = input.scopes.filter(
        (s) => !(TOKEN_SCOPES as readonly string[]).includes(s) || !own.has(s),
      );
      if (notAllowed.length > 0) return { ok: false, reason: "scope_not_allowed", scopes: notAllowed };
      if (input.expiresAt !== undefined && input.expiresAt.getTime() < now() + MIN_LIFETIME_SECONDS * 1000)
        return { ok: false, reason: "expiry_in_past" };

      const generated = generateApiToken();
      const scopes = [...new Set(input.scopes)].sort();
      const outcome = await withTenantTransaction(
        database,
        async (trx) => {
          // Obergrenze je Shop gegen Missbrauch. Bewusst eine weiche Grenze: Zwei genau gleichzeitige
          // Anfragen können sie um eins überschreiten; dafür braucht es keine Sperre.
          const { count } = await trx
            .selectFrom("identity.api_token")
            .select((eb) => eb.fn.countAll<string>().as("count"))
            .where("revoked_at", "is", null)
            .where((eb) => eb.or([eb("expires_at", "is", null), eb("expires_at", ">", new Date(now()))]))
            .executeTakeFirstOrThrow();
          if (Number(count) >= MAX_ACTIVE_TOKENS_PER_SHOP) return undefined;
          const row = await trx
            .insertInto("identity.api_token")
            .values({
              tenant_id: input.tenantId,
              name: input.name,
              token_prefix: generated.prefix,
              token_hash: generated.hash,
              scopes,
              actor_kind: "script",
              issued_for_user_id: input.userId,
              expires_at: input.expiresAt ?? null,
            })
            .returning(COLUMNS)
            .executeTakeFirstOrThrow();
          await publishEvent(trx, apiTokenCreated, {
            id: row.id,
            name: row.name,
            prefix: row.token_prefix,
            scopes,
            expiresAt: row.expires_at?.toISOString() ?? null,
          });
          return row;
        },
        { tenantId: input.tenantId, actorId: input.userId },
      );
      if (outcome === undefined) return { ok: false, reason: "too_many_tokens" };
      return { ok: true, token: generated.token, record: toRecord(outcome) };
    },

    async list(tenantId, { limit, beforeId }) {
      const rows = await withTenantTransaction(
        database,
        (trx) => {
          let q = trx
            .selectFrom("identity.api_token")
            .select(COLUMNS)
            .orderBy("id", "desc")
            .limit(limit + 1);
          if (beforeId !== undefined) q = q.where("id", "<", beforeId);
          return q.execute();
        },
        { tenantId },
      );
      return rows.map(toRecord);
    },

    async revoke(tenantId, id) {
      if (!isUuid(id)) return undefined;
      const row = await withTenantTransaction(
        database,
        async (trx) => {
          const before = await findById(trx, id);
          if (before === undefined || before.revoked_at !== null) return before;
          const after = await trx
            .updateTable("identity.api_token")
            .set({ revoked_at: new Date(now()) })
            .where("id", "=", id)
            .where("revoked_at", "is", null)
            .returning(COLUMNS)
            .executeTakeFirst();
          // Gleichzeitig schon widerrufen: Zeile so zurückgeben, wie sie jetzt ist, ohne zweites Ereignis.
          if (after === undefined) return findById(trx, id);
          await publishEvent(trx, apiTokenRevoked, {
            id: after.id,
            name: after.name,
            prefix: after.token_prefix,
          });
          return after;
        },
        { tenantId },
      );
      return row === undefined ? undefined : toRecord(row);
    },
  };
}
