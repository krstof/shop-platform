-- =============================================================================
-- Modul audit: unveränderliches Änderungsprotokoll
-- Erste Migration: legt das Schema an, wie es in Welle 0 entworfen wurde
-- (docs/04_Datenmodell.md). Läuft als Rolle shop_owner (eingestellt vom Migrationslauf).
-- =============================================================================

CREATE SCHEMA audit;

CREATE TABLE audit.audit_entry (
  id              uuid PRIMARY KEY DEFAULT uuidv7(),
  tenant_id       uuid REFERENCES platform.tenant(id),  -- NULL = Aktion in der Plattform-Verwaltung
  occurred_at     timestamptz NOT NULL DEFAULT now(),
  actor_type      text NOT NULL CHECK (actor_type IN ('user','api_token','ai','app','system','operator')),
  actor_id        uuid,
  on_behalf_of_user_id uuid,                     -- KI oder Support handelt im Namen von
  action          text NOT NULL,                 -- z. B. 'catalog.product.updated'
  entity_type     text NOT NULL,
  entity_id       uuid,
  changes         jsonb,                         -- {"feld": [alt, neu]}, ohne Geheimnisse
  request_id      uuid,
  correlation_id  uuid,
  ip_hash         bytea
);
CREATE INDEX audit_entry_tenant_time_idx ON audit.audit_entry (tenant_id, occurred_at DESC);
CREATE INDEX audit_entry_entity_idx ON audit.audit_entry (tenant_id, entity_type, entity_id);
ALTER TABLE audit.audit_entry ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit.audit_entry FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON audit.audit_entry
  USING (tenant_id = kernel.current_tenant_id())
  WITH CHECK (tenant_id = kernel.current_tenant_id());
CREATE POLICY platform_entries ON audit.audit_entry TO shop_platform
  USING (tenant_id IS NULL) WITH CHECK (tenant_id IS NULL);
SELECT kernel.make_append_only('audit.audit_entry');

CREATE TABLE audit.processed_event (
  tenant_id       uuid NOT NULL REFERENCES platform.tenant(id),
  event_id        uuid NOT NULL,
  subscriber      text NOT NULL,
  processed_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, subscriber, event_id)
);
SELECT kernel.enable_tenant_rls('audit.processed_event');

-- Rechte (Grants)
GRANT USAGE ON SCHEMA audit TO shop_app, shop_platform;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA audit TO shop_app;
-- Nur anhängen: kein UPDATE und kein DELETE
REVOKE UPDATE, DELETE ON audit.audit_entry FROM shop_app;
GRANT SELECT, INSERT ON audit.audit_entry TO shop_platform;
