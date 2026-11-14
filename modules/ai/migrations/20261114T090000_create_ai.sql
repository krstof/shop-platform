-- =============================================================================
-- Modul ai: KI-Assistent für Händler (Welle 2)
-- Erste Migration. Der Chat selbst speichert keine Unterhaltungen (das Backoffice hält sie nur im
-- Browser). Hier steht nur der Verbrauch je Shop und Tag, damit ein Tageslimit die Kosten des
-- Sprachmodells begrenzt. Läuft als Rolle shop_owner (eingestellt vom Migrationslauf).
-- =============================================================================

CREATE SCHEMA ai;

CREATE TABLE ai.usage_day (
  tenant_id       uuid NOT NULL REFERENCES platform.tenant(id),
  day             date NOT NULL,
  requests        integer NOT NULL DEFAULT 0 CHECK (requests >= 0),
  input_tokens    bigint NOT NULL DEFAULT 0 CHECK (input_tokens >= 0),
  output_tokens   bigint NOT NULL DEFAULT 0 CHECK (output_tokens >= 0),
  created_at      timestamptz NOT NULL DEFAULT now(),
  created_by      uuid DEFAULT kernel.current_actor_id(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  updated_by      uuid DEFAULT kernel.current_actor_id(),
  version         integer NOT NULL DEFAULT 1,
  PRIMARY KEY (tenant_id, day)
);
SELECT kernel.setup_tenant_table('ai.usage_day');

-- Rechte (Grants)
GRANT USAGE ON SCHEMA ai TO shop_app;
GRANT SELECT, INSERT, UPDATE ON ai.usage_day TO shop_app;
