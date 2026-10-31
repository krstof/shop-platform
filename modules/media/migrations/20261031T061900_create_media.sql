-- =============================================================================
-- Modul media: Bilder und Dokumente
-- Erste Migration: legt das Schema an, wie es in Welle 0 entworfen wurde
-- (docs/04_Datenmodell.md). Läuft als Rolle shop_owner (eingestellt vom Migrationslauf).
-- =============================================================================

CREATE SCHEMA media;

CREATE TABLE media.media_asset (
  tenant_id       uuid NOT NULL REFERENCES platform.tenant(id),
  id              uuid NOT NULL DEFAULT uuidv7(),
  kind            text NOT NULL CHECK (kind IN ('image','document','video')),
  storage_key     text NOT NULL,                 -- tenants/<tenant_id>/media/<id>/original
  original_filename text,
  mime_type       text NOT NULL,
  byte_size       bigint CHECK (byte_size >= 0),
  width           integer,
  height          integer,
  checksum_sha256 bytea,
  status          text NOT NULL DEFAULT 'pending_upload'
                    CHECK (status IN ('pending_upload','processing','ready','rejected','deleted')),
  rejection_reason text,
  ai_generated    boolean NOT NULL DEFAULT false, -- Kennzeichnung KI-Inhalte (KI-11)
  deleted_at      timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  created_by      uuid DEFAULT kernel.current_actor_id(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  updated_by      uuid DEFAULT kernel.current_actor_id(),
  version         integer NOT NULL DEFAULT 1,
  PRIMARY KEY (tenant_id, id),
  UNIQUE (tenant_id, storage_key),
  CHECK (storage_key LIKE 'tenants/' || tenant_id::text || '/%')
);
SELECT kernel.setup_tenant_table('media.media_asset');

CREATE TABLE media.media_asset_translation (
  tenant_id       uuid NOT NULL REFERENCES platform.tenant(id),
  media_asset_id  uuid NOT NULL,
  locale          kernel.locale_code NOT NULL,
  alt_text        text,                          -- Bildbeschreibung (Barrierefreiheit)
  title           text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  created_by      uuid DEFAULT kernel.current_actor_id(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  updated_by      uuid DEFAULT kernel.current_actor_id(),
  version         integer NOT NULL DEFAULT 1,
  PRIMARY KEY (tenant_id, media_asset_id, locale),
  FOREIGN KEY (tenant_id, media_asset_id) REFERENCES media.media_asset(tenant_id, id) ON DELETE CASCADE
);
SELECT kernel.setup_tenant_table('media.media_asset_translation');

CREATE TABLE media.media_rendition (
  tenant_id       uuid NOT NULL REFERENCES platform.tenant(id),
  id              uuid NOT NULL DEFAULT uuidv7(),
  media_asset_id  uuid NOT NULL,
  preset          text NOT NULL,                 -- z. B. 'w320', 'w640', 'w1280', 'thumb'
  format          text NOT NULL CHECK (format IN ('avif','webp','jpeg','png','pdf')),
  width           integer,
  height          integer,
  byte_size       bigint,
  storage_key     text NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  UNIQUE (tenant_id, media_asset_id, preset, format),
  FOREIGN KEY (tenant_id, media_asset_id) REFERENCES media.media_asset(tenant_id, id) ON DELETE CASCADE,
  CHECK (storage_key LIKE 'tenants/' || tenant_id::text || '/%')
);
SELECT kernel.enable_tenant_rls('media.media_rendition');

CREATE TABLE media.media_usage (
  tenant_id       uuid NOT NULL REFERENCES platform.tenant(id),
  media_asset_id  uuid NOT NULL,
  owner_module    text NOT NULL,                 -- z. B. 'catalog'
  owner_type      text NOT NULL,                 -- z. B. 'product'
  owner_id        uuid NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, media_asset_id, owner_module, owner_type, owner_id),
  FOREIGN KEY (tenant_id, media_asset_id) REFERENCES media.media_asset(tenant_id, id) ON DELETE CASCADE
);
CREATE INDEX media_usage_owner_idx ON media.media_usage (tenant_id, owner_module, owner_type, owner_id);
SELECT kernel.enable_tenant_rls('media.media_usage');

-- Rechte (Grants)
GRANT USAGE ON SCHEMA media TO shop_app;
-- Mandantentabellen: Lesen und Schreiben, RLS begrenzt auf den eigenen Shop
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA media TO shop_app;
