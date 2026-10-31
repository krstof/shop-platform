-- =============================================================================
-- Modul platform: Händler, Shops (Mandanten), Tarife, Domains (global)
-- Erste Migration: legt das Schema an, wie es in Welle 0 entworfen wurde
-- (docs/04_Datenmodell.md). Läuft als Rolle shop_owner (eingestellt vom Migrationslauf).
-- =============================================================================

CREATE SCHEMA platform;

CREATE TABLE platform.plan (
  id              uuid PRIMARY KEY DEFAULT uuidv7(),
  code            text NOT NULL UNIQUE,
  name            text NOT NULL,
  is_default      boolean NOT NULL DEFAULT false,
  limits          jsonb NOT NULL DEFAULT '{}'::jsonb,
  status          text NOT NULL DEFAULT 'active' CHECK (status IN ('active','retired')),
  created_at      timestamptz NOT NULL DEFAULT now(),
  created_by      uuid DEFAULT kernel.current_actor_id(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  updated_by      uuid DEFAULT kernel.current_actor_id(),
  version         integer NOT NULL DEFAULT 1
);
CREATE UNIQUE INDEX plan_one_default_idx ON platform.plan (is_default) WHERE is_default;
SELECT kernel.add_touch_trigger('platform.plan');

CREATE TABLE platform.plan_feature (
  plan_id         uuid NOT NULL REFERENCES platform.plan(id) ON DELETE CASCADE,
  feature_key     text NOT NULL,
  enabled         boolean NOT NULL DEFAULT true,
  limit_value     bigint,
  PRIMARY KEY (plan_id, feature_key)
);

CREATE TABLE platform.merchant (
  id              uuid PRIMARY KEY DEFAULT uuidv7(),
  name            text NOT NULL,
  contact_email   text,
  contact_name    text,
  status          text NOT NULL DEFAULT 'active' CHECK (status IN ('active','suspended','deleted')),
  notes           text,
  deleted_at      timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  created_by      uuid DEFAULT kernel.current_actor_id(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  updated_by      uuid DEFAULT kernel.current_actor_id(),
  version         integer NOT NULL DEFAULT 1
);
SELECT kernel.add_touch_trigger('platform.merchant');

CREATE TABLE platform.tenant (
  id              uuid PRIMARY KEY DEFAULT uuidv7(),
  merchant_id     uuid NOT NULL REFERENCES platform.merchant(id),
  plan_id         uuid NOT NULL REFERENCES platform.plan(id),
  handle          text NOT NULL UNIQUE CHECK (handle ~ '^[a-z0-9]([a-z0-9-]{1,61}[a-z0-9])$'),
  name            text NOT NULL,
  status          text NOT NULL DEFAULT 'provisioning'
                    CHECK (status IN ('provisioning','active','suspended','deleting','deleted')),
  default_locale  kernel.locale_code NOT NULL DEFAULT 'de',
  default_currency kernel.currency_code NOT NULL DEFAULT 'EUR',
  home_country    kernel.country_code NOT NULL DEFAULT 'DE',
  timezone        text NOT NULL DEFAULT 'Europe/Berlin',
  suspended_at    timestamptz,
  suspended_reason text,
  deleted_at      timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  created_by      uuid DEFAULT kernel.current_actor_id(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  updated_by      uuid DEFAULT kernel.current_actor_id(),
  version         integer NOT NULL DEFAULT 1
);
CREATE INDEX tenant_merchant_idx ON platform.tenant (merchant_id);
SELECT kernel.add_touch_trigger('platform.tenant');

CREATE TABLE platform.tenant_domain (
  id              uuid PRIMARY KEY DEFAULT uuidv7(),
  tenant_id       uuid NOT NULL REFERENCES platform.tenant(id),
  hostname        text NOT NULL CHECK (hostname = lower(hostname)),
  kind            text NOT NULL CHECK (kind IN ('subdomain','custom')),
  is_primary      boolean NOT NULL DEFAULT false,
  verified_at     timestamptz,
  verification_token_hash bytea,
  tls_status      text NOT NULL DEFAULT 'pending' CHECK (tls_status IN ('pending','active','failed')),
  created_at      timestamptz NOT NULL DEFAULT now(),
  created_by      uuid DEFAULT kernel.current_actor_id(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  updated_by      uuid DEFAULT kernel.current_actor_id(),
  version         integer NOT NULL DEFAULT 1
);
CREATE UNIQUE INDEX tenant_domain_hostname_idx ON platform.tenant_domain (hostname);
CREATE UNIQUE INDEX tenant_domain_primary_idx ON platform.tenant_domain (tenant_id) WHERE is_primary;
SELECT kernel.add_touch_trigger('platform.tenant_domain');

CREATE TABLE platform.tenant_feature_override (
  tenant_id       uuid NOT NULL REFERENCES platform.tenant(id),
  feature_key     text NOT NULL,
  enabled         boolean NOT NULL,
  limit_value     bigint,
  reason          text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, feature_key)
);

CREATE TABLE platform.platform_setting (
  key             text PRIMARY KEY,
  value           jsonb NOT NULL,                -- nie Geheimnisse, nur Verweise darauf
  updated_at      timestamptz NOT NULL DEFAULT now(),
  updated_by      uuid
);

CREATE TABLE platform.platform_user (
  id              uuid PRIMARY KEY DEFAULT uuidv7(),
  user_id         uuid NOT NULL UNIQUE,          -- Verweis auf identity.user (nur ID)
  role            text NOT NULL CHECK (role IN ('owner','operator','support','viewer')),
  status          text NOT NULL DEFAULT 'active' CHECK (status IN ('active','disabled')),
  created_at      timestamptz NOT NULL DEFAULT now(),
  created_by      uuid DEFAULT kernel.current_actor_id(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  updated_by      uuid DEFAULT kernel.current_actor_id(),
  version         integer NOT NULL DEFAULT 1
);
SELECT kernel.add_touch_trigger('platform.platform_user');

-- Referenzdaten (globale Tabellen)
INSERT INTO platform.plan (code, name, is_default, limits) VALUES
  ('standard', 'Standard', true, '{}');

-- Rechte (Grants)
GRANT USAGE ON SCHEMA platform TO shop_app, shop_platform;
GRANT SELECT ON platform.tenant, platform.tenant_domain, platform.plan, platform.plan_feature,
  platform.tenant_feature_override, platform.platform_setting TO shop_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA platform TO shop_platform;
