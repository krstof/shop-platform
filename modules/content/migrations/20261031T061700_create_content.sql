-- =============================================================================
-- Modul content: Inhaltsseiten, Rechtstexte, Menüs, Weiterleitungen
-- Erste Migration: legt das Schema an, wie es in Welle 0 entworfen wurde
-- (docs/04_Datenmodell.md). Läuft als Rolle shop_owner (eingestellt vom Migrationslauf).
-- =============================================================================

CREATE SCHEMA content;

CREATE TABLE content.page (
  tenant_id       uuid NOT NULL REFERENCES platform.tenant(id),
  id              uuid NOT NULL DEFAULT uuidv7(),
  kind            text NOT NULL DEFAULT 'content' CHECK (kind IN ('content','home','landing','contact')),
  status          text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','published','archived')),
  show_in_footer  boolean NOT NULL DEFAULT false,
  archived_at     timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  created_by      uuid DEFAULT kernel.current_actor_id(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  updated_by      uuid DEFAULT kernel.current_actor_id(),
  version         integer NOT NULL DEFAULT 1,
  PRIMARY KEY (tenant_id, id)
);
CREATE UNIQUE INDEX page_one_home_idx ON content.page (tenant_id) WHERE kind = 'home' AND archived_at IS NULL;
SELECT kernel.setup_tenant_table('content.page');

CREATE TABLE content.page_translation (
  tenant_id       uuid NOT NULL REFERENCES platform.tenant(id),
  page_id         uuid NOT NULL,
  locale          kernel.locale_code NOT NULL,
  title           text NOT NULL,
  slug            text NOT NULL CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  seo_title       text,
  seo_description text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  created_by      uuid DEFAULT kernel.current_actor_id(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  updated_by      uuid DEFAULT kernel.current_actor_id(),
  version         integer NOT NULL DEFAULT 1,
  PRIMARY KEY (tenant_id, page_id, locale),
  UNIQUE (tenant_id, locale, slug),
  FOREIGN KEY (tenant_id, page_id) REFERENCES content.page(tenant_id, id) ON DELETE CASCADE
);
SELECT kernel.setup_tenant_table('content.page_translation');

CREATE TABLE content.page_version (
  tenant_id       uuid NOT NULL REFERENCES platform.tenant(id),
  id              uuid NOT NULL DEFAULT uuidv7(),
  page_id         uuid NOT NULL,
  locale          kernel.locale_code NOT NULL,
  version_number  integer NOT NULL,
  state           text NOT NULL DEFAULT 'draft' CHECK (state IN ('draft','published','superseded')),
  document        jsonb NOT NULL,                -- {"schemaVersion":1,"sections":[...]} (ADR-005)
  origin          text NOT NULL DEFAULT 'user' CHECK (origin IN ('user','ai','template','import')),
  published_at    timestamptz,
  superseded_at   timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  created_by      uuid DEFAULT kernel.current_actor_id(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  updated_by      uuid DEFAULT kernel.current_actor_id(),
  version         integer NOT NULL DEFAULT 1,
  PRIMARY KEY (tenant_id, id),
  UNIQUE (tenant_id, page_id, locale, version_number),
  FOREIGN KEY (tenant_id, page_id) REFERENCES content.page(tenant_id, id) ON DELETE CASCADE,
  CHECK (jsonb_typeof(document -> 'sections') = 'array')
);
CREATE UNIQUE INDEX page_version_one_draft_idx ON content.page_version (tenant_id, page_id, locale) WHERE state = 'draft';
CREATE UNIQUE INDEX page_version_one_published_idx ON content.page_version (tenant_id, page_id, locale) WHERE state = 'published';
SELECT kernel.setup_tenant_table('content.page_version');
CREATE TRIGGER aa_version_guard BEFORE UPDATE OR DELETE ON content.page_version
  FOR EACH ROW EXECUTE FUNCTION kernel.tg_published_version_guard();

CREATE TABLE content.legal_document (
  tenant_id       uuid NOT NULL REFERENCES platform.tenant(id),
  id              uuid NOT NULL DEFAULT uuidv7(),
  type            text NOT NULL CHECK (type IN ('imprint','terms','withdrawal_policy','withdrawal_form',
                    'privacy','shipping_payment','accessibility_statement','cookie_policy')),
  country_code    kernel.country_code,           -- NULL = gilt für alle Länder (INT-06 ab Welle 4)
  is_required     boolean NOT NULL DEFAULT true,
  footer_position integer NOT NULL DEFAULT 0,
  created_at      timestamptz NOT NULL DEFAULT now(),
  created_by      uuid DEFAULT kernel.current_actor_id(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  updated_by      uuid DEFAULT kernel.current_actor_id(),
  version         integer NOT NULL DEFAULT 1,
  PRIMARY KEY (tenant_id, id),
  CONSTRAINT legal_document_type_unique UNIQUE NULLS NOT DISTINCT (tenant_id, type, country_code)
);
SELECT kernel.setup_tenant_table('content.legal_document');

CREATE TABLE content.legal_document_version (
  tenant_id       uuid NOT NULL REFERENCES platform.tenant(id),
  id              uuid NOT NULL DEFAULT uuidv7(),
  legal_document_id uuid NOT NULL,
  locale          kernel.locale_code NOT NULL,
  version_number  integer NOT NULL,
  state           text NOT NULL DEFAULT 'draft' CHECK (state IN ('draft','published','superseded')),
  title           text NOT NULL,
  slug            text NOT NULL CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  document        jsonb NOT NULL,                -- Abschnitte und Bausteine wie bei Seiten
  content_hash    bytea,                         -- SHA-256 des veröffentlichten Inhalts
  source          text NOT NULL DEFAULT 'template' CHECK (source IN ('template','merchant','provider')),
  published_at    timestamptz,
  superseded_at   timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  created_by      uuid DEFAULT kernel.current_actor_id(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  updated_by      uuid DEFAULT kernel.current_actor_id(),
  version         integer NOT NULL DEFAULT 1,
  PRIMARY KEY (tenant_id, id),
  UNIQUE (tenant_id, legal_document_id, locale, version_number),
  FOREIGN KEY (tenant_id, legal_document_id) REFERENCES content.legal_document(tenant_id, id),
  CHECK (state = 'draft' OR (content_hash IS NOT NULL AND published_at IS NOT NULL))
);
CREATE UNIQUE INDEX legal_version_one_draft_idx ON content.legal_document_version (tenant_id, legal_document_id, locale) WHERE state = 'draft';
CREATE UNIQUE INDEX legal_version_one_published_idx ON content.legal_document_version (tenant_id, legal_document_id, locale) WHERE state = 'published';
SELECT kernel.setup_tenant_table('content.legal_document_version');
CREATE TRIGGER aa_version_guard BEFORE UPDATE OR DELETE ON content.legal_document_version
  FOR EACH ROW EXECUTE FUNCTION kernel.tg_published_version_guard();

CREATE TABLE content.navigation_menu (
  tenant_id       uuid NOT NULL REFERENCES platform.tenant(id),
  id              uuid NOT NULL DEFAULT uuidv7(),
  key             text NOT NULL CHECK (key IN ('main','footer')),
  items           jsonb NOT NULL DEFAULT '[]'::jsonb,  -- [{type:'category'|'page'|'url', ref, children}]
  created_at      timestamptz NOT NULL DEFAULT now(),
  created_by      uuid DEFAULT kernel.current_actor_id(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  updated_by      uuid DEFAULT kernel.current_actor_id(),
  version         integer NOT NULL DEFAULT 1,
  PRIMARY KEY (tenant_id, id),
  UNIQUE (tenant_id, key),
  CHECK (jsonb_typeof(items) = 'array')
);
SELECT kernel.setup_tenant_table('content.navigation_menu');

CREATE TABLE content.url_redirect (
  tenant_id       uuid NOT NULL REFERENCES platform.tenant(id),
  id              uuid NOT NULL DEFAULT uuidv7(),
  from_path       text NOT NULL CHECK (from_path LIKE '/%'),
  to_path         text NOT NULL CHECK (to_path LIKE '/%'),
  status_code     smallint NOT NULL DEFAULT 301 CHECK (status_code IN (301,302,308)),
  reason          text NOT NULL DEFAULT 'slug_change' CHECK (reason IN ('slug_change','manual','import')),
  created_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  UNIQUE (tenant_id, from_path),
  CHECK (from_path <> to_path)
);
SELECT kernel.enable_tenant_rls('content.url_redirect');

-- Rechte (Grants)
GRANT USAGE ON SCHEMA content TO shop_app;
-- Mandantentabellen: Lesen und Schreiben, RLS begrenzt auf den eigenen Shop
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA content TO shop_app;
