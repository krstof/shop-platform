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
  couponId: async (db, tenantId) => {
    const { rows } = await db.query<{ id: string }>(
      `INSERT INTO pricing.coupon (tenant_id, code, kind, value) VALUES ($1, $2, 'percent', 10) RETURNING id`,
      [tenantId, `T08-${randomBytes(4).toString("hex").toUpperCase()}`],
    );
    return rows[0]?.id ?? "";
  },
  // Kategorie mit deutschem Namen (ohne Übersetzung ist sie in der API unsichtbar).
  categoryId: async (db, tenantId) => {
    const { rows } = await db.query<{ id: string }>(
      `WITH c AS (INSERT INTO catalog.category (tenant_id) VALUES ($1) RETURNING id),
            t AS (INSERT INTO catalog.category_translation (tenant_id, category_id, locale, name, slug)
                  SELECT $1, id, 'de', 'T-08 Kategorie', $2 FROM c)
       SELECT id FROM c`,
      [tenantId, `t08-${randomBytes(6).toString("hex")}`],
    );
    return rows[0]?.id ?? "";
  },
  // Produkt mit Standardvariante und Text in einer Anweisung (Prüfung A-05 am Ende der Transaktion).
  productId: async (db, tenantId) => {
    const { rows } = await db.query<{ id: string }>(
      `WITH p AS (INSERT INTO catalog.product (tenant_id) VALUES ($1) RETURNING id),
            v AS (INSERT INTO catalog.variant (tenant_id, product_id, is_default) SELECT $1, id, true FROM p),
            t AS (INSERT INTO catalog.product_translation (tenant_id, product_id, locale, name, slug)
                  SELECT $1, id, 'de', 'T-08 Produkt', $2 FROM p)
       SELECT id FROM p`,
      [tenantId, `t08-${randomBytes(6).toString("hex")}`],
    );
    return rows[0]?.id ?? "";
  },
  // Bild am Produkt (M2 Teil 2): nur die Zeilen, ohne Dateien im Speicher.
  imageId: async (db, tenantId) => {
    const { rows } = await db.query<{ id: string }>(
      `INSERT INTO media.media_asset (tenant_id, id, kind, storage_key, mime_type, status)
       SELECT $1::uuid, i, 'image', 'tenants/' || $1::text || '/media/' || i || '/original', 'image/png', 'ready'
       FROM (SELECT uuidv7() AS i) x RETURNING id`,
      [tenantId],
    );
    return rows[0]?.id ?? "";
  },
  // Bezahlte, offene Bestellung (M7): „versenden“ würde klappen, wenn die Mandantentrennung fehlte.
  orderId: async (db, tenantId) => {
    const { rows } = await db.query<{ id: string }>(
      `WITH c AS (INSERT INTO shop_settings.sales_channel (tenant_id, code, kind, name)
                  VALUES ($1, $2, 'storefront', 'T-08') RETURNING id)
       INSERT INTO orders."order" (tenant_id, order_number, channel_id, email, locale, currency, tax_display,
                                   subtotal_amount, tax_amount, total_amount, status, payment_status)
       SELECT $1, $2, c.id, 't08@example.org', 'de', 'EUR', 'gross', 100, 0, 100, 'open', 'paid' FROM c
       RETURNING id`,
      [tenantId, `t08-${randomBytes(4).toString("hex")}`],
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
  // Eine Mitarbeiterin (nicht die Inhaberin: Die ließe sich gar nicht entfernen, der Test soll aber
  // zeigen, dass schon das Finden am fremden Shop scheitert).
  memberId: async (db, tenantId) => {
    const { rows: users } = await db.query<{ id: string }>(
      `INSERT INTO identity."user" (email) VALUES ($1) RETURNING id`,
      [`t08-${randomBytes(6).toString("hex")}@teeladen.example`],
    );
    const { rows } = await db.query<{ id: string }>(
      `INSERT INTO identity.membership (tenant_id, user_id, role_key) VALUES ($1, $2, 'staff') RETURNING id`,
      [tenantId, users[0]?.id],
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
