-- =============================================================================
-- Modul storefront: Themes, Theme-Einstellungen, Vorlagen (Editor-Grundlage)
-- Erste Migration: legt das Schema an, wie es in Welle 0 entworfen wurde
-- (docs/04_Datenmodell.md). Läuft als Rolle shop_owner (eingestellt vom Migrationslauf).
-- =============================================================================

CREATE SCHEMA storefront;

CREATE TABLE storefront.theme (                   -- global, von der Plattform geliefert
  code            text PRIMARY KEY,
  name            text NOT NULL,
  theme_version   text NOT NULL,
  settings_schema jsonb NOT NULL DEFAULT '{}'::jsonb,
  is_available    boolean NOT NULL DEFAULT true
);

CREATE TABLE storefront.theme_installation (
  tenant_id       uuid NOT NULL REFERENCES platform.tenant(id),
  id              uuid NOT NULL DEFAULT uuidv7(),
  theme_code      text NOT NULL,                 -- Verweis auf storefront.theme
  is_active       boolean NOT NULL DEFAULT false,
  settings_draft  jsonb NOT NULL DEFAULT '{}'::jsonb,     -- Farben, Schriften, Logo (Welle 2)
  settings_published jsonb NOT NULL DEFAULT '{}'::jsonb,
  published_at    timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  created_by      uuid DEFAULT kernel.current_actor_id(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  updated_by      uuid DEFAULT kernel.current_actor_id(),
  version         integer NOT NULL DEFAULT 1,
  PRIMARY KEY (tenant_id, id),
  UNIQUE (tenant_id, theme_code)
);
CREATE UNIQUE INDEX theme_installation_active_idx ON storefront.theme_installation (tenant_id) WHERE is_active;
SELECT kernel.setup_tenant_table('storefront.theme_installation');

CREATE TABLE storefront.template (
  tenant_id       uuid NOT NULL REFERENCES platform.tenant(id),
  id              uuid NOT NULL DEFAULT uuidv7(),
  theme_installation_id uuid NOT NULL,
  kind            text NOT NULL CHECK (kind IN ('home','product','category','cart','checkout','page','header','footer','search','error')),
  created_at      timestamptz NOT NULL DEFAULT now(),
  created_by      uuid DEFAULT kernel.current_actor_id(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  updated_by      uuid DEFAULT kernel.current_actor_id(),
  version         integer NOT NULL DEFAULT 1,
  PRIMARY KEY (tenant_id, id),
  UNIQUE (tenant_id, theme_installation_id, kind),
  FOREIGN KEY (tenant_id, theme_installation_id) REFERENCES storefront.theme_installation(tenant_id, id) ON DELETE CASCADE
);
SELECT kernel.setup_tenant_table('storefront.template');

CREATE TABLE storefront.template_version (
  tenant_id       uuid NOT NULL REFERENCES platform.tenant(id),
  id              uuid NOT NULL DEFAULT uuidv7(),
  template_id     uuid NOT NULL,
  version_number  integer NOT NULL,
  state           text NOT NULL DEFAULT 'draft' CHECK (state IN ('draft','published','superseded')),
  document        jsonb NOT NULL,                -- {"schemaVersion":1,"sections":[...]}
  origin          text NOT NULL DEFAULT 'user' CHECK (origin IN ('user','ai','template','import')),
  published_at    timestamptz,
  superseded_at   timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  created_by      uuid DEFAULT kernel.current_actor_id(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  updated_by      uuid DEFAULT kernel.current_actor_id(),
  version         integer NOT NULL DEFAULT 1,
  PRIMARY KEY (tenant_id, id),
  UNIQUE (tenant_id, template_id, version_number),
  FOREIGN KEY (tenant_id, template_id) REFERENCES storefront.template(tenant_id, id) ON DELETE CASCADE,
  CHECK (jsonb_typeof(document -> 'sections') = 'array')
);
CREATE UNIQUE INDEX template_version_one_draft_idx ON storefront.template_version (tenant_id, template_id) WHERE state = 'draft';
CREATE UNIQUE INDEX template_version_one_published_idx ON storefront.template_version (tenant_id, template_id) WHERE state = 'published';
SELECT kernel.setup_tenant_table('storefront.template_version');
CREATE TRIGGER aa_version_guard BEFORE UPDATE OR DELETE ON storefront.template_version
  FOR EACH ROW EXECUTE FUNCTION kernel.tg_published_version_guard();

-- Referenzdaten (globale Tabellen)
INSERT INTO storefront.theme (code, name, theme_version, settings_schema) VALUES
  ('standard', 'Standard', '1.0.0', '{"type":"object"}');

-- Rechte (Grants)
GRANT USAGE ON SCHEMA storefront TO shop_app;
-- Mandantentabellen: Lesen und Schreiben, RLS begrenzt auf den eigenen Shop
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA storefront TO shop_app;
-- Globale Referenzdaten (Themes): nur lesen
REVOKE INSERT, UPDATE, DELETE ON storefront.theme FROM shop_app;
