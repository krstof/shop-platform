-- =============================================================================
-- Modul integrations: Anbindungen an fremde Dienste je Shop (21.11.2026)
--
-- Bis hierher gab es im System keinen Ort für einen Zugangsschlüssel je Shop: Der einzige
-- Schlüssel, der für den KI-Assistenten, kommt aus einer Umgebungsvariablen und gilt für die ganze
-- Plattform. Dienste wie Telegram, Unsplash oder DeepL brauchen aber einen Schlüssel pro Shop.
--
-- Zugangsdaten stehen verschlüsselt in `secrets` (Umschlagverschlüsselung aus dem Kernel,
-- packages/kernel/src/secret-box.ts). Der Hauptschlüssel liegt nur in der Serverkonfiguration,
-- nie in der Datenbank. Der Zweck jedes Werts bindet ihn an Shop und Dienst, damit eine in eine
-- andere Zeile kopierte Zeichenkette beim Lesen einen Fehler gibt statt eines fremden Geheimnisses.
--
-- Läuft als Rolle shop_owner (eingestellt vom Migrationslauf).
-- =============================================================================

CREATE SCHEMA integrations;

CREATE TABLE integrations.connection (
  tenant_id     uuid NOT NULL REFERENCES platform.tenant(id),
  id            uuid NOT NULL DEFAULT uuidv7(),
  provider      text NOT NULL,                       -- 'telegram', 'unsplash', ... (Katalog im Code)
  enabled       boolean NOT NULL DEFAULT false,
  settings      jsonb NOT NULL DEFAULT '{}'::jsonb,  -- nicht geheim, darf an den Browser
  secrets       bytea,                               -- verschlüsseltes JSON-Objekt, nie an den Browser
  checked_at    timestamptz,                         -- letzte Verbindungsprüfung
  check_ok      boolean,
  check_message text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  created_by    uuid,
  updated_at    timestamptz NOT NULL DEFAULT now(),
  updated_by    uuid,
  version       integer NOT NULL DEFAULT 1,
  PRIMARY KEY (tenant_id, id),
  CONSTRAINT connection_provider_len CHECK (char_length(provider) BETWEEN 1 AND 40),
  CONSTRAINT connection_message_len CHECK (check_message IS NULL OR char_length(check_message) <= 500)
);

-- Ein Dienst kann je Shop nur einmal eingerichtet sein.
CREATE UNIQUE INDEX connection_provider_idx ON integrations.connection (tenant_id, provider);

SELECT kernel.setup_tenant_table('integrations.connection');

-- Rechte (Grants)
GRANT USAGE ON SCHEMA integrations TO shop_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA integrations TO shop_app;
