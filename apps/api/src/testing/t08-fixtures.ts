// Testfabriken für T-08: Für jeden Pfad-Platzhalter der Admin-API legt eine Fabrik einen
// Datensatz in einem Shop an und gibt seine ID zurück. Neue Endpunkte mit neuen Platzhaltern
// brauchen hier einen Eintrag, sonst scheitert der T-08-Test mit einem klaren Hinweis.
import { createHash, randomBytes } from "node:crypto";
import type pg from "pg";

export type Fixture = (db: pg.Client, tenantId: string) => Promise<string>;

export const T08_FIXTURES: Readonly<Record<string, Fixture>> = {
  manufacturerId: async (db, tenantId) => {
    const { rows } = await db.query<{ id: string }>(
      `INSERT INTO catalog.manufacturer (tenant_id, name) VALUES ($1, 'T-08 Hersteller') RETURNING id`,
      [tenantId],
    );
    return rows[0]?.id ?? "";
  },
  apiTokenId: async (db, tenantId) => {
    const token = `shp_at_${randomBytes(32).toString("base64url")}`;
    const { rows } = await db.query<{ id: string }>(
      `INSERT INTO identity.api_token (tenant_id, name, token_prefix, token_hash, scopes)
       VALUES ($1, 'T-08 Token', $2, $3, '{products:read}') RETURNING id`,
      [tenantId, token.slice(0, 11), createHash("sha256").update(token).digest()],
    );
    return rows[0]?.id ?? "";
  },
  // Kein Pfad-Platzhalter, sondern Daten für die Liste GET /admin/v1/audit-entries: Ohne Einträge
  // in beiden Shops könnte der Test nicht zeigen, dass A nichts aus B sieht.
  auditEntryId: async (db, tenantId) => {
    const { rows } = await db.query<{ id: string }>(
      `INSERT INTO audit.audit_entry (tenant_id, actor_type, action, entity_type)
       VALUES ($1, 'system', 'catalog.manufacturer.created.v1', 'catalog.manufacturer') RETURNING id`,
      [tenantId],
    );
    return rows[0]?.id ?? "";
  },
};
