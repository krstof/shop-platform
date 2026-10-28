-- =============================================================================
-- schema_welle1.sql
-- Datenbankstruktur der Shop-Plattform für Welle 1 (inklusive vorbereiteter
-- Tabellen für spätere Wellen). Beschreibung: docs/04_Datenmodell.md
--
-- Zielsystem: PostgreSQL 18 (getestet mit 18.6). uuidv7() ist ab Version 18 eingebaut.
-- Ausführen als Superuser auf einer LEEREN Datenbank:
--   psql -v ON_ERROR_STOP=1 -d <datenbank> -f db/schema_welle1.sql
-- Später wird diese Datei in Migrationen pro Modul aufgeteilt (modules/<modul>/migrations).
--
-- Regeln (verbindlich, siehe ADR-002, ADR-003, ADR-006):
--   * ein Schema pro Modul, keine Fremdschlüssel über Modulgrenzen
--     (einzige Ausnahme: tenant_id -> platform.tenant)
--   * jede Mandantentabelle: tenant_id, Primärschlüssel (tenant_id, id),
--     RLS ENABLE + FORCE, Policy über app.tenant_id
--   * Geld: *_amount bigint + currency, Steuersätze in Basispunkten
--   * keine Passwörter oder Geheimnisse in dieser Datei
-- =============================================================================

\set ON_ERROR_STOP on
SET client_min_messages = warning;

-- -----------------------------------------------------------------------------
-- 0. Rollen (ohne Passwörter; Passwörter setzt der Betrieb aus der .env)
-- -----------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'shop_owner') THEN
    CREATE ROLE shop_owner NOLOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'shop_app') THEN
    CREATE ROLE shop_app LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOINHERIT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'shop_platform') THEN
    CREATE ROLE shop_platform LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOINHERIT;
  END IF;
  -- Anmeldemodul: einzige Rolle mit Zugriff auf Passwort-Hashes, Sitzungen und Einmalcodes
  -- (Sicherheitskonzept 4.2, ADR-008)
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'shop_auth') THEN
    CREATE ROLE shop_auth LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOINHERIT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'shop_relay') THEN
    CREATE ROLE shop_relay LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOINHERIT;
  END IF;
  -- Datensicherung: pg_dump verweigert bei aktivem RLS die Arbeit, deshalb braucht
  -- nur diese Rolle BYPASSRLS. Sie wird nie von der Anwendung benutzt.
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'shop_backup') THEN
    CREATE ROLE shop_backup LOGIN NOSUPERUSER BYPASSRLS NOCREATEDB NOCREATEROLE NOINHERIT;
  END IF;
END $$;

-- Erweiterung für Ausschluss-Regeln (keine überlappenden Steuersatz-Zeiträume)
CREATE EXTENSION IF NOT EXISTS btree_gist;

-- Ab hier legt shop_owner alle Objekte an und besitzt sie.
GRANT CREATE ON DATABASE :"DBNAME" TO shop_owner;
SET ROLE shop_owner;

-- =============================================================================
-- 1. Schema kernel: gemeinsame Werkzeuge, Referenzdaten, Outbox, Idempotenz
-- =============================================================================
CREATE SCHEMA kernel;

-- Wertebereiche (Domains) für immer wiederkehrende Codes
CREATE DOMAIN kernel.currency_code AS char(3) CHECK (VALUE ~ '^[A-Z]{3}$');
CREATE DOMAIN kernel.country_code  AS char(2) CHECK (VALUE ~ '^[A-Z]{2}$');
CREATE DOMAIN kernel.locale_code   AS text    CHECK (VALUE ~ '^[a-z]{2,3}(-[A-Z]{2})?$');
CREATE DOMAIN kernel.rate_bp       AS integer CHECK (VALUE BETWEEN 0 AND 100000);

-- Kontext der laufenden Transaktion. Leerer Wert = NULL = keine Zeilen (geschlossen im Zweifel).
CREATE FUNCTION kernel.current_tenant_id() RETURNS uuid
  LANGUAGE sql STABLE PARALLEL SAFE
  AS $$ SELECT nullif(current_setting('app.tenant_id', true), '')::uuid $$;

CREATE FUNCTION kernel.current_actor_id() RETURNS uuid
  LANGUAGE sql STABLE PARALLEL SAFE
  AS $$ SELECT nullif(current_setting('app.actor_id', true), '')::uuid $$;

CREATE FUNCTION kernel.current_user_id() RETURNS uuid
  LANGUAGE sql STABLE PARALLEL SAFE
  AS $$ SELECT nullif(current_setting('app.user_id', true), '')::uuid $$;

-- Hash (SHA-256, hexadezimal) des API-Tokens, das gerade geprüft wird
CREATE FUNCTION kernel.current_api_token_hash() RETURNS bytea
  LANGUAGE sql STABLE PARALLEL SAFE
  AS $$ SELECT decode(nullif(current_setting('app.api_token_hash', true), ''), 'hex') $$;

-- Trigger: Version hochzählen (ETag), updated_at/updated_by setzen, created_* schützen
CREATE FUNCTION kernel.tg_touch_row() RETURNS trigger
  LANGUAGE plpgsql AS $$
BEGIN
  NEW.version    := OLD.version + 1;
  NEW.updated_at := now();
  NEW.updated_by := kernel.current_actor_id();
  NEW.created_at := OLD.created_at;
  NEW.created_by := OLD.created_by;
  RETURN NEW;
END $$;

-- Trigger: Tabelle darf nur wachsen (Protokolle, Momentaufnahmen)
CREATE FUNCTION kernel.tg_append_only() RETURNS trigger
  LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Tabelle %.% ist nur anhängbar (append-only)', TG_TABLE_SCHEMA, TG_TABLE_NAME
    USING ERRCODE = 'P0001';
END $$;

-- Trigger: veröffentlichte Versionen (state <> 'draft') sind unveränderlich,
-- erlaubt ist nur der Wechsel published -> superseded.
CREATE FUNCTION kernel.tg_published_version_guard() RETURNS trigger
  LANGUAGE plpgsql AS $$
DECLARE
  allowed text[] := ARRAY['state','superseded_at','updated_at','updated_by','version'];
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.state <> 'draft' THEN
      RAISE EXCEPTION 'Veröffentlichte Version darf nicht gelöscht werden' USING ERRCODE = 'P0001';
    END IF;
    RETURN OLD;
  END IF;
  IF OLD.state <> 'draft' THEN
    IF (to_jsonb(NEW) - allowed) IS DISTINCT FROM (to_jsonb(OLD) - allowed)
       OR NOT (OLD.state = NEW.state OR (OLD.state = 'published' AND NEW.state = 'superseded')) THEN
      RAISE EXCEPTION 'Veröffentlichte Version ist unveränderlich' USING ERRCODE = 'P0001';
    END IF;
  END IF;
  RETURN NEW;
END $$;

-- Helfer für Migrationen (nur shop_owner darf sie ausführen)
CREATE FUNCTION kernel.enable_tenant_rls(p_table regclass) RETURNS void
  LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE format('ALTER TABLE %s ENABLE ROW LEVEL SECURITY', p_table);
  EXECUTE format('ALTER TABLE %s FORCE ROW LEVEL SECURITY', p_table);
  EXECUTE format(
    'CREATE POLICY tenant_isolation ON %s
       USING      (tenant_id = kernel.current_tenant_id())
       WITH CHECK (tenant_id = kernel.current_tenant_id())', p_table);
END $$;

CREATE FUNCTION kernel.add_touch_trigger(p_table regclass) RETURNS void
  LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE format('CREATE TRIGGER zz_touch_row BEFORE UPDATE ON %s
                  FOR EACH ROW EXECUTE FUNCTION kernel.tg_touch_row()', p_table);
END $$;

CREATE FUNCTION kernel.make_append_only(p_table regclass) RETURNS void
  LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE format('CREATE TRIGGER aa_append_only BEFORE UPDATE OR DELETE ON %s
                  FOR EACH ROW EXECUTE FUNCTION kernel.tg_append_only()', p_table);
END $$;

-- Standard-Mandantentabelle: RLS + Versionszähler
CREATE FUNCTION kernel.setup_tenant_table(p_table regclass) RETURNS void
  LANGUAGE plpgsql AS $$
BEGIN
  PERFORM kernel.enable_tenant_rls(p_table);
  PERFORM kernel.add_touch_trigger(p_table);
END $$;

REVOKE ALL ON FUNCTION kernel.enable_tenant_rls(regclass), kernel.add_touch_trigger(regclass),
  kernel.make_append_only(regclass), kernel.setup_tenant_table(regclass) FROM PUBLIC;

-- Referenzdaten: Währungen (global)
CREATE TABLE kernel.currency (
  code            kernel.currency_code PRIMARY KEY,
  minor_units     smallint NOT NULL CHECK (minor_units BETWEEN 0 AND 4),
  rounding_mode   text NOT NULL DEFAULT 'half_up' CHECK (rounding_mode IN ('half_up','half_even')),
  cash_rounding_minor smallint NOT NULL DEFAULT 1,
  symbol          text NOT NULL,
  name_de         text NOT NULL
);

-- Referenzdaten: Länder (global)
CREATE TABLE kernel.country (
  code            kernel.country_code PRIMARY KEY,
  name_de         text NOT NULL,
  is_eu           boolean NOT NULL DEFAULT false,
  default_currency kernel.currency_code,
  requires_region boolean NOT NULL DEFAULT false,
  address_format  jsonb NOT NULL DEFAULT '{}'::jsonb
);

-- Outbox (ADR-007): Ereignisse, in derselben Transaktion wie die Datenänderung geschrieben
CREATE TABLE kernel.outbox (
  id              uuid PRIMARY KEY DEFAULT uuidv7(),
  tenant_id       uuid,                          -- NULL nur bei plattformweiten Ereignissen
  type            text NOT NULL CHECK (type ~ '^[a-z_]+\.[a-z_]+\.[a-z_]+\.v[0-9]+$'),
  occurred_at     timestamptz NOT NULL DEFAULT now(),
  actor           jsonb NOT NULL,
  correlation_id  uuid NOT NULL,
  causation_id    uuid,
  data            jsonb NOT NULL,
  published_at    timestamptz,
  attempts        integer NOT NULL DEFAULT 0,
  last_error      text
);
CREATE INDEX outbox_unpublished_idx ON kernel.outbox (occurred_at) WHERE published_at IS NULL;
CREATE INDEX outbox_tenant_idx ON kernel.outbox (tenant_id, occurred_at);
ALTER TABLE kernel.outbox ENABLE ROW LEVEL SECURITY;
ALTER TABLE kernel.outbox FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON kernel.outbox
  USING (tenant_id = kernel.current_tenant_id())
  WITH CHECK (tenant_id = kernel.current_tenant_id());
CREATE POLICY platform_events ON kernel.outbox TO shop_platform
  USING (tenant_id IS NULL) WITH CHECK (tenant_id IS NULL);
CREATE POLICY relay_all ON kernel.outbox TO shop_relay
  USING (true) WITH CHECK (true);

-- Idempotenz-Schlüssel (Architektur 4.5), 24 Stunden gültig
CREATE TABLE kernel.idempotency_key (
  tenant_id       uuid NOT NULL,
  id              uuid NOT NULL DEFAULT uuidv7(),
  scope           text NOT NULL,                 -- z. B. 'store:placeOrder'
  key             text NOT NULL CHECK (length(key) BETWEEN 8 AND 255),
  request_hash    bytea NOT NULL,
  status          text NOT NULL DEFAULT 'in_progress' CHECK (status IN ('in_progress','completed')),
  response_status smallint,
  response_body   jsonb,
  created_at      timestamptz NOT NULL DEFAULT now(),
  expires_at      timestamptz NOT NULL DEFAULT now() + interval '24 hours',
  PRIMARY KEY (tenant_id, id),
  UNIQUE (tenant_id, scope, key)
);
CREATE INDEX idempotency_key_expiry_idx ON kernel.idempotency_key (tenant_id, expires_at);
SELECT kernel.enable_tenant_rls('kernel.idempotency_key');

-- =============================================================================
-- 2. Schema platform: Händler, Shops (Mandanten), Tarife, Domains (global)
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

-- =============================================================================
-- 3. Schema identity: Anmeldung (global), Mitgliedschaften und Token (je Shop)
-- =============================================================================
CREATE SCHEMA identity;

CREATE TABLE identity."user" (
  id              uuid PRIMARY KEY DEFAULT uuidv7(),
  email           text NOT NULL,
  email_verified  boolean NOT NULL DEFAULT false,
  name            text,
  image_url       text,
  locale          kernel.locale_code NOT NULL DEFAULT 'de',
  status          text NOT NULL DEFAULT 'active' CHECK (status IN ('active','locked','disabled')),
  locked_until    timestamptz,
  two_factor_enabled boolean NOT NULL DEFAULT false,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX user_email_idx ON identity."user" (lower(email));

CREATE TABLE identity.account (
  id              uuid PRIMARY KEY DEFAULT uuidv7(),
  user_id         uuid NOT NULL REFERENCES identity."user"(id) ON DELETE CASCADE,
  provider_id     text NOT NULL,                 -- 'credential' = E-Mail und Passwort
  account_id      text NOT NULL,
  password_hash   text,                          -- Argon2id, nie Klartext
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (provider_id, account_id)
);
CREATE INDEX account_user_idx ON identity.account (user_id);

CREATE TABLE identity.session (
  id              uuid PRIMARY KEY DEFAULT uuidv7(),
  user_id         uuid NOT NULL REFERENCES identity."user"(id) ON DELETE CASCADE,
  token_hash      bytea NOT NULL UNIQUE,
  expires_at      timestamptz NOT NULL,
  ip_address      inet,
  user_agent      text,
  impersonated_by uuid,                          -- Support-Zugriff (Welle 5)
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX session_user_idx ON identity.session (user_id);
CREATE INDEX session_expiry_idx ON identity.session (expires_at);

CREATE TABLE identity.verification (
  id              uuid PRIMARY KEY DEFAULT uuidv7(),
  identifier      text NOT NULL,
  value_hash      bytea NOT NULL,
  purpose         text NOT NULL CHECK (purpose IN ('email_verification','password_reset','email_change','invitation')),
  expires_at      timestamptz NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX verification_identifier_idx ON identity.verification (identifier);

CREATE TABLE identity.two_factor (           -- vorbereitet, genutzt ab Welle 2 (SIC-09)
  id              uuid PRIMARY KEY DEFAULT uuidv7(),
  user_id         uuid NOT NULL UNIQUE REFERENCES identity."user"(id) ON DELETE CASCADE,
  secret_encrypted bytea NOT NULL,
  backup_codes_encrypted bytea NOT NULL,
  enabled_at      timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE identity.passkey (              -- vorbereitet, genutzt ab Welle 2 (SIC-09)
  id              uuid PRIMARY KEY DEFAULT uuidv7(),
  user_id         uuid NOT NULL REFERENCES identity."user"(id) ON DELETE CASCADE,
  name            text,
  credential_id   text NOT NULL UNIQUE,
  public_key      bytea NOT NULL,
  sign_count      bigint NOT NULL DEFAULT 0,
  device_type     text,
  backed_up       boolean NOT NULL DEFAULT false,
  transports      text[],
  last_used_at    timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX passkey_user_idx ON identity.passkey (user_id);

-- Eigene Rollen eines Shops (vorbereitet, genutzt ab Welle 5, PLA-09).
-- Systemrollen ('owner', 'staff') stehen im Code.
CREATE TABLE identity.role (
  tenant_id       uuid NOT NULL REFERENCES platform.tenant(id),
  id              uuid NOT NULL DEFAULT uuidv7(),
  key             text NOT NULL,
  name            text NOT NULL,
  description     text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  created_by      uuid DEFAULT kernel.current_actor_id(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  updated_by      uuid DEFAULT kernel.current_actor_id(),
  version         integer NOT NULL DEFAULT 1,
  PRIMARY KEY (tenant_id, id),
  UNIQUE (tenant_id, key)
);
SELECT kernel.setup_tenant_table('identity.role');

CREATE TABLE identity.role_permission (
  tenant_id       uuid NOT NULL REFERENCES platform.tenant(id),
  role_id         uuid NOT NULL,
  permission      text NOT NULL CHECK (permission ~ '^[a-z_]+:(read|write)$'),
  created_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, role_id, permission),
  FOREIGN KEY (tenant_id, role_id) REFERENCES identity.role(tenant_id, id) ON DELETE CASCADE
);
SELECT kernel.enable_tenant_rls('identity.role_permission');

CREATE TABLE identity.membership (
  tenant_id       uuid NOT NULL REFERENCES platform.tenant(id),
  id              uuid NOT NULL DEFAULT uuidv7(),
  user_id         uuid NOT NULL REFERENCES identity."user"(id),
  role_key        text NOT NULL DEFAULT 'owner',   -- Systemrolle oder 'custom'
  role_id         uuid,                            -- nur bei role_key = 'custom'
  status          text NOT NULL DEFAULT 'active' CHECK (status IN ('invited','active','disabled')),
  invited_by      uuid,
  created_at      timestamptz NOT NULL DEFAULT now(),
  created_by      uuid DEFAULT kernel.current_actor_id(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  updated_by      uuid DEFAULT kernel.current_actor_id(),
  version         integer NOT NULL DEFAULT 1,
  PRIMARY KEY (tenant_id, id),
  UNIQUE (tenant_id, user_id),
  FOREIGN KEY (tenant_id, role_id) REFERENCES identity.role(tenant_id, id),
  CHECK ((role_key = 'custom') = (role_id IS NOT NULL))
);
CREATE UNIQUE INDEX membership_one_owner_idx ON identity.membership (tenant_id) WHERE role_key = 'owner';
CREATE INDEX membership_user_idx ON identity.membership (user_id);
ALTER TABLE identity.membership ENABLE ROW LEVEL SECURITY;
ALTER TABLE identity.membership FORCE ROW LEVEL SECURITY;
-- Lesen: eigener Shop ODER eigene Mitgliedschaften (für die Shop-Auswahl nach dem Login)
CREATE POLICY tenant_isolation ON identity.membership
  USING (tenant_id = kernel.current_tenant_id() OR user_id = kernel.current_user_id())
  WITH CHECK (tenant_id = kernel.current_tenant_id());
SELECT kernel.add_touch_trigger('identity.membership');

CREATE TABLE identity.api_token (
  tenant_id       uuid NOT NULL REFERENCES platform.tenant(id),
  id              uuid NOT NULL DEFAULT uuidv7(),
  name            text NOT NULL,
  token_prefix    text NOT NULL,                 -- z. B. 'shp_at_3f9a' zum Wiedererkennen
  token_hash      bytea NOT NULL UNIQUE,         -- SHA-256 des Tokens, nie das Token selbst
  scopes          text[] NOT NULL CHECK (cardinality(scopes) > 0),
  actor_kind      text NOT NULL DEFAULT 'script' CHECK (actor_kind IN ('script','ai','app','integration')),
  issued_for_user_id uuid,
  expires_at      timestamptz,
  last_used_at    timestamptz,
  revoked_at      timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  created_by      uuid DEFAULT kernel.current_actor_id(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  updated_by      uuid DEFAULT kernel.current_actor_id(),
  version         integer NOT NULL DEFAULT 1,
  PRIMARY KEY (tenant_id, id)
);
ALTER TABLE identity.api_token ENABLE ROW LEVEL SECURITY;
ALTER TABLE identity.api_token FORCE ROW LEVEL SECURITY;
-- Lesen: eigener Shop ODER genau das Token, dessen Hash gerade geprüft wird
CREATE POLICY tenant_isolation ON identity.api_token
  USING (tenant_id = kernel.current_tenant_id() OR token_hash = kernel.current_api_token_hash())
  WITH CHECK (tenant_id = kernel.current_tenant_id());
SELECT kernel.add_touch_trigger('identity.api_token');

-- =============================================================================
-- 4. Schema shop_settings: Firmendaten, Kanäle, Länder, Zonen, Nummernkreise, Cookies
-- =============================================================================
CREATE SCHEMA shop_settings;

CREATE TABLE shop_settings.shop_profile (
  tenant_id       uuid NOT NULL REFERENCES platform.tenant(id),
  id              uuid NOT NULL DEFAULT uuidv7(),
  shop_name       text NOT NULL,
  company_name    text,
  legal_form      text,
  representative  text,
  address_line1   text,
  address_line2   text,
  postal_code     text,
  city            text,
  region_code     text,
  country_code    kernel.country_code NOT NULL DEFAULT 'DE',
  email           text,
  phone           text,
  vat_id          text,                          -- USt-IdNr.
  tax_number      text,                          -- Steuernummer
  register_court  text,
  register_number text,
  supervisory_authority text,
  dispute_resolution text NOT NULL DEFAULT 'not_willing'
                    CHECK (dispute_resolution IN ('not_willing','willing','obliged')),
  packaging_register_number text,                -- LUCID (Verpackungsregister)
  timezone        text NOT NULL DEFAULT 'Europe/Berlin',
  online_status   text NOT NULL DEFAULT 'offline' CHECK (online_status IN ('offline','online')),
  went_online_at  timestamptz,
  logo_media_id   uuid,
  custom_fields   jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at      timestamptz NOT NULL DEFAULT now(),
  created_by      uuid DEFAULT kernel.current_actor_id(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  updated_by      uuid DEFAULT kernel.current_actor_id(),
  version         integer NOT NULL DEFAULT 1,
  PRIMARY KEY (tenant_id, id),
  UNIQUE (tenant_id)
);
SELECT kernel.setup_tenant_table('shop_settings.shop_profile');

CREATE TABLE shop_settings.sales_channel (
  tenant_id       uuid NOT NULL REFERENCES platform.tenant(id),
  id              uuid NOT NULL DEFAULT uuidv7(),
  code            text NOT NULL,
  kind            text NOT NULL CHECK (kind IN ('storefront','ai_agent','marketplace','pos','api','feed')),
  name            text NOT NULL,
  is_default      boolean NOT NULL DEFAULT false,
  status          text NOT NULL DEFAULT 'active' CHECK (status IN ('active','disabled')),
  default_locale  kernel.locale_code NOT NULL DEFAULT 'de',
  locales         kernel.locale_code[] NOT NULL DEFAULT ARRAY['de']::kernel.locale_code[],
  default_currency kernel.currency_code NOT NULL DEFAULT 'EUR',
  currencies      kernel.currency_code[] NOT NULL DEFAULT ARRAY['EUR']::kernel.currency_code[],
  default_country kernel.country_code NOT NULL DEFAULT 'DE',
  tax_display     text NOT NULL DEFAULT 'gross' CHECK (tax_display IN ('gross','net')),
  settings        jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at      timestamptz NOT NULL DEFAULT now(),
  created_by      uuid DEFAULT kernel.current_actor_id(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  updated_by      uuid DEFAULT kernel.current_actor_id(),
  version         integer NOT NULL DEFAULT 1,
  PRIMARY KEY (tenant_id, id),
  UNIQUE (tenant_id, code)
);
CREATE UNIQUE INDEX sales_channel_default_idx ON shop_settings.sales_channel (tenant_id) WHERE is_default;
SELECT kernel.setup_tenant_table('shop_settings.sales_channel');

CREATE TABLE shop_settings.sales_country (
  tenant_id       uuid NOT NULL REFERENCES platform.tenant(id),
  country_code    kernel.country_code NOT NULL,
  enabled         boolean NOT NULL DEFAULT true,
  created_at      timestamptz NOT NULL DEFAULT now(),
  created_by      uuid DEFAULT kernel.current_actor_id(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  updated_by      uuid DEFAULT kernel.current_actor_id(),
  version         integer NOT NULL DEFAULT 1,
  PRIMARY KEY (tenant_id, country_code)
);
SELECT kernel.setup_tenant_table('shop_settings.sales_country');

CREATE TABLE shop_settings.zone (
  tenant_id       uuid NOT NULL REFERENCES platform.tenant(id),
  id              uuid NOT NULL DEFAULT uuidv7(),
  code            text NOT NULL,
  name            text NOT NULL,
  purpose         text NOT NULL DEFAULT 'shipping' CHECK (purpose IN ('shipping','tax','payment','market')),
  created_at      timestamptz NOT NULL DEFAULT now(),
  created_by      uuid DEFAULT kernel.current_actor_id(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  updated_by      uuid DEFAULT kernel.current_actor_id(),
  version         integer NOT NULL DEFAULT 1,
  PRIMARY KEY (tenant_id, id),
  UNIQUE (tenant_id, code)
);
SELECT kernel.setup_tenant_table('shop_settings.zone');

CREATE TABLE shop_settings.zone_country (
  tenant_id       uuid NOT NULL REFERENCES platform.tenant(id),
  zone_id         uuid NOT NULL,
  country_code    kernel.country_code NOT NULL,
  region_code     text NOT NULL DEFAULT '',      -- '' = ganzes Land
  postal_code_pattern text,                       -- später, z. B. Inseln
  PRIMARY KEY (tenant_id, zone_id, country_code, region_code),
  FOREIGN KEY (tenant_id, zone_id) REFERENCES shop_settings.zone(tenant_id, id) ON DELETE CASCADE
);
SELECT kernel.enable_tenant_rls('shop_settings.zone_country');

CREATE TABLE shop_settings.number_range (
  tenant_id       uuid NOT NULL REFERENCES platform.tenant(id),
  id              uuid NOT NULL DEFAULT uuidv7(),
  kind            text NOT NULL CHECK (kind IN ('order','customer','invoice','credit_note','withdrawal','delivery_note')),
  prefix          text NOT NULL DEFAULT '',
  include_year    boolean NOT NULL DEFAULT false,
  min_digits      smallint NOT NULL DEFAULT 5 CHECK (min_digits BETWEEN 1 AND 12),
  start_value     bigint NOT NULL DEFAULT 1 CHECK (start_value >= 1),
  next_value      bigint NOT NULL DEFAULT 1 CHECK (next_value >= 1),
  current_period  text NOT NULL DEFAULT '',
  created_at      timestamptz NOT NULL DEFAULT now(),
  created_by      uuid DEFAULT kernel.current_actor_id(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  updated_by      uuid DEFAULT kernel.current_actor_id(),
  version         integer NOT NULL DEFAULT 1,
  PRIMARY KEY (tenant_id, id),
  UNIQUE (tenant_id, kind)
);
SELECT kernel.setup_tenant_table('shop_settings.number_range');

-- Lückenlose Nummern: Die Zeile des Nummernkreises wird bis zum Ende der Transaktion
-- gesperrt. Wird die Transaktion zurückgerollt, ist auch die Nummer nie vergeben worden.
CREATE FUNCTION shop_settings.next_number(p_kind text) RETURNS text
  LANGUAGE plpgsql AS $$
DECLARE
  r        shop_settings.number_range;
  v_tz     text;
  v_period text;
  v_value  bigint;
BEGIN
  SELECT * INTO r FROM shop_settings.number_range
   WHERE tenant_id = kernel.current_tenant_id() AND kind = p_kind
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Nummernkreis % ist nicht eingerichtet', p_kind USING ERRCODE = 'P0002';
  END IF;
  SELECT timezone INTO v_tz FROM shop_settings.shop_profile WHERE tenant_id = r.tenant_id;
  v_period := CASE WHEN r.include_year
                   THEN to_char(now() AT TIME ZONE coalesce(v_tz, 'Europe/Berlin'), 'YYYY')
                   ELSE '' END;
  v_value := CASE WHEN v_period <> r.current_period THEN r.start_value ELSE r.next_value END;
  UPDATE shop_settings.number_range
     SET next_value = v_value + 1, current_period = v_period
   WHERE tenant_id = r.tenant_id AND id = r.id;
  RETURN r.prefix
      || CASE WHEN v_period <> '' THEN v_period || '-' ELSE '' END
      || lpad(v_value::text, r.min_digits, '0');
END $$;

-- Dienste, die Cookies setzen (Welle 1: nur technisch notwendige, für die Datenschutzseite)
CREATE TABLE shop_settings.cookie_service (
  tenant_id       uuid NOT NULL REFERENCES platform.tenant(id),
  id              uuid NOT NULL DEFAULT uuidv7(),
  key             text NOT NULL,
  category        text NOT NULL CHECK (category IN ('necessary','preferences','statistics','marketing')),
  provider        text NOT NULL,
  purpose         text NOT NULL,
  cookie_names    text[] NOT NULL DEFAULT '{}',
  retention       text,
  enabled         boolean NOT NULL DEFAULT true,
  created_at      timestamptz NOT NULL DEFAULT now(),
  created_by      uuid DEFAULT kernel.current_actor_id(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  updated_by      uuid DEFAULT kernel.current_actor_id(),
  version         integer NOT NULL DEFAULT 1,
  PRIMARY KEY (tenant_id, id),
  UNIQUE (tenant_id, key)
);
SELECT kernel.setup_tenant_table('shop_settings.cookie_service');

CREATE TABLE shop_settings.cookie_consent_config (  -- vorbereitet, genutzt ab Welle 2 (STR-13)
  tenant_id       uuid NOT NULL REFERENCES platform.tenant(id),
  id              uuid NOT NULL DEFAULT uuidv7(),
  banner_mode     text NOT NULL DEFAULT 'auto' CHECK (banner_mode IN ('auto','always','never')),
  config_revision integer NOT NULL DEFAULT 1,     -- steigt bei jeder inhaltlichen Änderung
  texts           jsonb NOT NULL DEFAULT '{}'::jsonb,  -- je Sprache
  created_at      timestamptz NOT NULL DEFAULT now(),
  created_by      uuid DEFAULT kernel.current_actor_id(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  updated_by      uuid DEFAULT kernel.current_actor_id(),
  version         integer NOT NULL DEFAULT 1,
  PRIMARY KEY (tenant_id, id),
  UNIQUE (tenant_id)
);
SELECT kernel.setup_tenant_table('shop_settings.cookie_consent_config');

CREATE TABLE shop_settings.cookie_consent_log (     -- vorbereitet, genutzt ab Welle 2 (STR-13)
  tenant_id       uuid NOT NULL REFERENCES platform.tenant(id),
  id              uuid NOT NULL DEFAULT uuidv7(),
  consent_ref     uuid NOT NULL,                 -- zufällige Kennung im Cookie des Besuchers
  config_revision integer NOT NULL,
  choices         jsonb NOT NULL,                -- {"statistics":false,"marketing":false}
  ip_hash         bytea,
  user_agent_hash bytea,
  created_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id)
);
CREATE INDEX cookie_consent_log_ref_idx ON shop_settings.cookie_consent_log (tenant_id, consent_ref);
SELECT kernel.enable_tenant_rls('shop_settings.cookie_consent_log');
SELECT kernel.make_append_only('shop_settings.cookie_consent_log');

-- =============================================================================
-- 5. Schema audit: unveränderliches Änderungsprotokoll
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

-- =============================================================================
-- 6. Schema catalog: Produkte, Varianten, Merkmale, Kategorien, Hersteller
-- =============================================================================
CREATE SCHEMA catalog;

-- Hersteller mit GPSR-Angaben (STR-10, A-25)
CREATE TABLE catalog.manufacturer (
  tenant_id       uuid NOT NULL REFERENCES platform.tenant(id),
  id              uuid NOT NULL DEFAULT uuidv7(),
  name            text NOT NULL,
  trade_name      text,
  address_line1   text,
  address_line2   text,
  postal_code     text,
  city            text,
  country_code    kernel.country_code,
  email           text,
  website_url     text,
  -- verantwortliche Person in der EU (Pflicht, wenn der Hersteller außerhalb der EU sitzt)
  eu_responsible_name    text,
  eu_responsible_address text,
  eu_responsible_email   text,
  eu_responsible_phone   text,
  archived_at     timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  created_by      uuid DEFAULT kernel.current_actor_id(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  updated_by      uuid DEFAULT kernel.current_actor_id(),
  version         integer NOT NULL DEFAULT 1,
  PRIMARY KEY (tenant_id, id)
);
CREATE INDEX manufacturer_name_idx ON catalog.manufacturer (tenant_id, lower(name));
SELECT kernel.setup_tenant_table('catalog.manufacturer');

CREATE TABLE catalog.product_type (               -- vorbereitet, genutzt ab Welle 2 (PRD-09)
  tenant_id       uuid NOT NULL REFERENCES platform.tenant(id),
  id              uuid NOT NULL DEFAULT uuidv7(),
  code            text NOT NULL,
  name            text NOT NULL,                 -- nur im Backoffice sichtbar
  archived_at     timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  created_by      uuid DEFAULT kernel.current_actor_id(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  updated_by      uuid DEFAULT kernel.current_actor_id(),
  version         integer NOT NULL DEFAULT 1,
  PRIMARY KEY (tenant_id, id),
  UNIQUE (tenant_id, code)
);
SELECT kernel.setup_tenant_table('catalog.product_type');

CREATE TABLE catalog.attribute (                  -- vorbereitet, genutzt ab Welle 2 (PRD-10, A-06)
  tenant_id       uuid NOT NULL REFERENCES platform.tenant(id),
  id              uuid NOT NULL DEFAULT uuidv7(),
  code            text NOT NULL,
  input_type      text NOT NULL CHECK (input_type IN ('select','multiselect','text','number','boolean','color')),
  unit            text,
  is_filterable   boolean NOT NULL DEFAULT false,
  position        integer NOT NULL DEFAULT 0,
  created_at      timestamptz NOT NULL DEFAULT now(),
  created_by      uuid DEFAULT kernel.current_actor_id(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  updated_by      uuid DEFAULT kernel.current_actor_id(),
  version         integer NOT NULL DEFAULT 1,
  PRIMARY KEY (tenant_id, id),
  UNIQUE (tenant_id, code)
);
SELECT kernel.setup_tenant_table('catalog.attribute');

CREATE TABLE catalog.attribute_translation (
  tenant_id       uuid NOT NULL REFERENCES platform.tenant(id),
  attribute_id    uuid NOT NULL,
  locale          kernel.locale_code NOT NULL,
  name            text NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  created_by      uuid DEFAULT kernel.current_actor_id(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  updated_by      uuid DEFAULT kernel.current_actor_id(),
  version         integer NOT NULL DEFAULT 1,
  PRIMARY KEY (tenant_id, attribute_id, locale),
  FOREIGN KEY (tenant_id, attribute_id) REFERENCES catalog.attribute(tenant_id, id) ON DELETE CASCADE
);
SELECT kernel.setup_tenant_table('catalog.attribute_translation');

CREATE TABLE catalog.attribute_value (
  tenant_id       uuid NOT NULL REFERENCES platform.tenant(id),
  id              uuid NOT NULL DEFAULT uuidv7(),
  attribute_id    uuid NOT NULL,
  code            text NOT NULL,
  swatch          text,                          -- Farbcode oder Bild-ID bei Farben
  position        integer NOT NULL DEFAULT 0,
  created_at      timestamptz NOT NULL DEFAULT now(),
  created_by      uuid DEFAULT kernel.current_actor_id(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  updated_by      uuid DEFAULT kernel.current_actor_id(),
  version         integer NOT NULL DEFAULT 1,
  PRIMARY KEY (tenant_id, id),
  UNIQUE (tenant_id, attribute_id, code),
  FOREIGN KEY (tenant_id, attribute_id) REFERENCES catalog.attribute(tenant_id, id) ON DELETE CASCADE
);
SELECT kernel.setup_tenant_table('catalog.attribute_value');

CREATE TABLE catalog.attribute_value_translation (
  tenant_id       uuid NOT NULL REFERENCES platform.tenant(id),
  attribute_value_id uuid NOT NULL,
  locale          kernel.locale_code NOT NULL,
  label           text NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  created_by      uuid DEFAULT kernel.current_actor_id(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  updated_by      uuid DEFAULT kernel.current_actor_id(),
  version         integer NOT NULL DEFAULT 1,
  PRIMARY KEY (tenant_id, attribute_value_id, locale),
  FOREIGN KEY (tenant_id, attribute_value_id) REFERENCES catalog.attribute_value(tenant_id, id) ON DELETE CASCADE
);
SELECT kernel.setup_tenant_table('catalog.attribute_value_translation');

CREATE TABLE catalog.product_type_attribute (
  tenant_id       uuid NOT NULL REFERENCES platform.tenant(id),
  product_type_id uuid NOT NULL,
  attribute_id    uuid NOT NULL,
  usage           text NOT NULL CHECK (usage IN ('variant_axis','product_info')),
  is_required     boolean NOT NULL DEFAULT false,
  position        integer NOT NULL DEFAULT 0,
  PRIMARY KEY (tenant_id, product_type_id, attribute_id),
  FOREIGN KEY (tenant_id, product_type_id) REFERENCES catalog.product_type(tenant_id, id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, attribute_id) REFERENCES catalog.attribute(tenant_id, id)
);
CREATE INDEX product_type_attribute_attr_idx ON catalog.product_type_attribute (tenant_id, attribute_id);
SELECT kernel.enable_tenant_rls('catalog.product_type_attribute');

CREATE TABLE catalog.product (
  tenant_id       uuid NOT NULL REFERENCES platform.tenant(id),
  id              uuid NOT NULL DEFAULT uuidv7(),
  status          text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','published','archived')),
  product_type_id uuid,
  manufacturer_id uuid,
  tax_class_code  text NOT NULL DEFAULT 'standard',   -- Verweis auf tax.tax_class (nur Code)
  delivery_time_min_days smallint CHECK (delivery_time_min_days >= 0),
  delivery_time_max_days smallint CHECK (delivery_time_max_days >= 0),
  withdrawal_exclusion text CHECK (withdrawal_exclusion IN
                    ('custom_made','perishable','sealed_hygiene','sealed_media','digital_content','other')),
  is_shippable    boolean NOT NULL DEFAULT true,
  custom_fields   jsonb NOT NULL DEFAULT '{}'::jsonb,
  published_at    timestamptz,
  archived_at     timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  created_by      uuid DEFAULT kernel.current_actor_id(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  updated_by      uuid DEFAULT kernel.current_actor_id(),
  version         integer NOT NULL DEFAULT 1,
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, product_type_id) REFERENCES catalog.product_type(tenant_id, id),
  FOREIGN KEY (tenant_id, manufacturer_id) REFERENCES catalog.manufacturer(tenant_id, id),
  CHECK (delivery_time_max_days IS NULL OR delivery_time_min_days IS NULL
         OR delivery_time_max_days >= delivery_time_min_days)
);
CREATE INDEX product_status_idx ON catalog.product (tenant_id, status, id);
CREATE INDEX product_manufacturer_idx ON catalog.product (tenant_id, manufacturer_id);
CREATE INDEX product_type_idx ON catalog.product (tenant_id, product_type_id);
SELECT kernel.setup_tenant_table('catalog.product');

CREATE TABLE catalog.product_translation (
  tenant_id       uuid NOT NULL REFERENCES platform.tenant(id),
  product_id      uuid NOT NULL,
  locale          kernel.locale_code NOT NULL,
  name            text NOT NULL,
  slug            text NOT NULL CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  description     jsonb NOT NULL DEFAULT '{"type":"doc","content":[]}'::jsonb,  -- strukturierter Text, kein HTML
  key_features    text,                          -- wesentliche Merkmale (STR-04)
  safety_information text,                       -- Warn- und Sicherheitshinweise (GPSR)
  delivery_time_text text,                       -- optionaler Freitext statt Tagen
  seo_title       text,
  seo_description text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  created_by      uuid DEFAULT kernel.current_actor_id(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  updated_by      uuid DEFAULT kernel.current_actor_id(),
  version         integer NOT NULL DEFAULT 1,
  PRIMARY KEY (tenant_id, product_id, locale),
  UNIQUE (tenant_id, locale, slug),
  FOREIGN KEY (tenant_id, product_id) REFERENCES catalog.product(tenant_id, id) ON DELETE CASCADE
);
SELECT kernel.setup_tenant_table('catalog.product_translation');

CREATE TABLE catalog.product_attribute_value (    -- vorbereitet, genutzt ab Welle 2
  tenant_id       uuid NOT NULL REFERENCES platform.tenant(id),
  id              uuid NOT NULL DEFAULT uuidv7(),
  product_id      uuid NOT NULL,
  attribute_id    uuid NOT NULL,
  attribute_value_id uuid,                       -- bei Auswahl-Merkmalen
  value_text      text,                          -- bei Freitext
  value_number    numeric(18,6),                 -- bei Zahlen (keine Geldbeträge)
  value_boolean   boolean,
  position        integer NOT NULL DEFAULT 0,
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, product_id) REFERENCES catalog.product(tenant_id, id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, attribute_id) REFERENCES catalog.attribute(tenant_id, id),
  FOREIGN KEY (tenant_id, attribute_value_id) REFERENCES catalog.attribute_value(tenant_id, id)
);
CREATE INDEX product_attribute_value_product_idx ON catalog.product_attribute_value (tenant_id, product_id);
CREATE INDEX product_attribute_value_filter_idx ON catalog.product_attribute_value (tenant_id, attribute_id, attribute_value_id);
SELECT kernel.enable_tenant_rls('catalog.product_attribute_value');

CREATE TABLE catalog.variant (
  tenant_id       uuid NOT NULL REFERENCES platform.tenant(id),
  id              uuid NOT NULL DEFAULT uuidv7(),
  product_id      uuid NOT NULL,
  is_default      boolean NOT NULL DEFAULT false,
  sku             text,                          -- Artikelnummer
  gtin            text CHECK (gtin ~ '^[0-9]{8,14}$'),
  position        integer NOT NULL DEFAULT 0,
  status          text NOT NULL DEFAULT 'active' CHECK (status IN ('active','archived')),
  weight_grams    integer CHECK (weight_grams >= 0),
  -- Grundpreis (STR-03): Inhalt 500 g, Bezug 1 kg -> "x € / 1 kg"
  unit_content_quantity numeric(12,4) CHECK (unit_content_quantity > 0),
  unit_content_unit     text CHECK (unit_content_unit IN ('g','kg','ml','l','cm','m','m2','m3','piece')),
  unit_base_quantity    numeric(12,4) CHECK (unit_base_quantity > 0),
  unit_base_unit        text CHECK (unit_base_unit IN ('g','kg','ml','l','cm','m','m2','m3','piece')),
  track_inventory boolean NOT NULL DEFAULT true,
  custom_fields   jsonb NOT NULL DEFAULT '{}'::jsonb,
  archived_at     timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  created_by      uuid DEFAULT kernel.current_actor_id(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  updated_by      uuid DEFAULT kernel.current_actor_id(),
  version         integer NOT NULL DEFAULT 1,
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, product_id) REFERENCES catalog.product(tenant_id, id) ON DELETE CASCADE,
  CHECK ((unit_content_quantity IS NULL) = (unit_content_unit IS NULL)
     AND (unit_base_quantity IS NULL) = (unit_base_unit IS NULL)
     AND (unit_content_quantity IS NULL) = (unit_base_quantity IS NULL))
);
CREATE INDEX variant_product_idx ON catalog.variant (tenant_id, product_id, position);
CREATE UNIQUE INDEX variant_sku_idx ON catalog.variant (tenant_id, sku) WHERE sku IS NOT NULL;
CREATE UNIQUE INDEX variant_one_default_idx ON catalog.variant (tenant_id, product_id) WHERE is_default;
SELECT kernel.setup_tenant_table('catalog.variant');

-- Jedes Produkt hat genau eine Standardvariante (A-05). Geprüft am Ende der Transaktion,
-- damit Produkt und Variante in beliebiger Reihenfolge angelegt werden können.
CREATE FUNCTION catalog.tg_check_default_variant() RETURNS trigger
  LANGUAGE plpgsql AS $$
DECLARE
  v_tenant  uuid;
  v_product uuid;
BEGIN
  IF TG_TABLE_NAME = 'product' THEN
    v_tenant := NEW.tenant_id; v_product := NEW.id;
  ELSE
    v_tenant := OLD.tenant_id; v_product := OLD.product_id;
  END IF;
  IF EXISTS (SELECT 1 FROM catalog.product p WHERE p.tenant_id = v_tenant AND p.id = v_product)
     AND NOT EXISTS (SELECT 1 FROM catalog.variant v
                      WHERE v.tenant_id = v_tenant AND v.product_id = v_product AND v.is_default) THEN
    RAISE EXCEPTION 'Produkt % hat keine Standardvariante', v_product USING ERRCODE = '23514';
  END IF;
  RETURN NULL;
END $$;

CREATE CONSTRAINT TRIGGER product_has_default_variant
  AFTER INSERT ON catalog.product
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION catalog.tg_check_default_variant();
CREATE CONSTRAINT TRIGGER variant_keeps_default
  AFTER UPDATE OF is_default, product_id OR DELETE ON catalog.variant
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION catalog.tg_check_default_variant();

CREATE TABLE catalog.variant_translation (        -- vorbereitet, genutzt ab Welle 2
  tenant_id       uuid NOT NULL REFERENCES platform.tenant(id),
  variant_id      uuid NOT NULL,
  locale          kernel.locale_code NOT NULL,
  title           text NOT NULL,                 -- z. B. "Größe M, Rot"
  created_at      timestamptz NOT NULL DEFAULT now(),
  created_by      uuid DEFAULT kernel.current_actor_id(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  updated_by      uuid DEFAULT kernel.current_actor_id(),
  version         integer NOT NULL DEFAULT 1,
  PRIMARY KEY (tenant_id, variant_id, locale),
  FOREIGN KEY (tenant_id, variant_id) REFERENCES catalog.variant(tenant_id, id) ON DELETE CASCADE
);
SELECT kernel.setup_tenant_table('catalog.variant_translation');

CREATE TABLE catalog.variant_attribute_value (    -- vorbereitet, genutzt ab Welle 2 (PRD-11)
  tenant_id       uuid NOT NULL REFERENCES platform.tenant(id),
  variant_id      uuid NOT NULL,
  attribute_id    uuid NOT NULL,
  attribute_value_id uuid NOT NULL,
  PRIMARY KEY (tenant_id, variant_id, attribute_id),
  FOREIGN KEY (tenant_id, variant_id) REFERENCES catalog.variant(tenant_id, id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, attribute_id) REFERENCES catalog.attribute(tenant_id, id),
  FOREIGN KEY (tenant_id, attribute_value_id) REFERENCES catalog.attribute_value(tenant_id, id)
);
CREATE INDEX variant_attribute_value_value_idx ON catalog.variant_attribute_value (tenant_id, attribute_value_id);
SELECT kernel.enable_tenant_rls('catalog.variant_attribute_value');

CREATE TABLE catalog.category (
  tenant_id       uuid NOT NULL REFERENCES platform.tenant(id),
  id              uuid NOT NULL DEFAULT uuidv7(),
  parent_id       uuid,                          -- NULL = oberste Ebene
  position        integer NOT NULL DEFAULT 0,
  status          text NOT NULL DEFAULT 'visible' CHECK (status IN ('visible','hidden','archived')),
  kind            text NOT NULL DEFAULT 'manual' CHECK (kind IN ('manual','rule_based')),
  rule            jsonb,                         -- Regel für automatische Kategorien (Welle 2, KAT-03)
  image_media_id  uuid,
  archived_at     timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  created_by      uuid DEFAULT kernel.current_actor_id(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  updated_by      uuid DEFAULT kernel.current_actor_id(),
  version         integer NOT NULL DEFAULT 1,
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, parent_id) REFERENCES catalog.category(tenant_id, id),
  CHECK (parent_id IS DISTINCT FROM id),
  CHECK ((kind = 'rule_based') = (rule IS NOT NULL))
);
CREATE INDEX category_parent_idx ON catalog.category (tenant_id, parent_id, position);
SELECT kernel.setup_tenant_table('catalog.category');

-- Kreise im Kategoriebaum verhindern (A ist Elternteil von B ist Elternteil von A)
CREATE FUNCTION catalog.tg_category_no_cycle() RETURNS trigger
  LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.parent_id IS NOT NULL AND EXISTS (
    WITH RECURSIVE up(id, parent_id) AS (
      SELECT c.id, c.parent_id FROM catalog.category c
       WHERE c.tenant_id = NEW.tenant_id AND c.id = NEW.parent_id
      UNION ALL
      SELECT c.id, c.parent_id FROM catalog.category c
        JOIN up ON c.tenant_id = NEW.tenant_id AND c.id = up.parent_id
    ) CYCLE id SET is_cycle USING path
    SELECT 1 FROM up WHERE up.id = NEW.id
  ) THEN
    RAISE EXCEPTION 'Kategorie % würde einen Kreis bilden', NEW.id USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER category_no_cycle BEFORE INSERT OR UPDATE OF parent_id ON catalog.category
  FOR EACH ROW EXECUTE FUNCTION catalog.tg_category_no_cycle();

CREATE TABLE catalog.category_translation (
  tenant_id       uuid NOT NULL REFERENCES platform.tenant(id),
  category_id     uuid NOT NULL,
  locale          kernel.locale_code NOT NULL,
  name            text NOT NULL,
  slug            text NOT NULL CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  description     jsonb NOT NULL DEFAULT '{"type":"doc","content":[]}'::jsonb,
  seo_title       text,
  seo_description text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  created_by      uuid DEFAULT kernel.current_actor_id(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  updated_by      uuid DEFAULT kernel.current_actor_id(),
  version         integer NOT NULL DEFAULT 1,
  PRIMARY KEY (tenant_id, category_id, locale),
  UNIQUE (tenant_id, locale, slug),
  FOREIGN KEY (tenant_id, category_id) REFERENCES catalog.category(tenant_id, id) ON DELETE CASCADE
);
SELECT kernel.setup_tenant_table('catalog.category_translation');

CREATE TABLE catalog.product_category (
  tenant_id       uuid NOT NULL REFERENCES platform.tenant(id),
  category_id     uuid NOT NULL,
  product_id      uuid NOT NULL,
  position        integer NOT NULL DEFAULT 0,
  is_primary      boolean NOT NULL DEFAULT false, -- Hauptkategorie für Brotkrümel und Adresse
  PRIMARY KEY (tenant_id, category_id, product_id),
  FOREIGN KEY (tenant_id, category_id) REFERENCES catalog.category(tenant_id, id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, product_id) REFERENCES catalog.product(tenant_id, id) ON DELETE CASCADE
);
CREATE INDEX product_category_product_idx ON catalog.product_category (tenant_id, product_id);
CREATE UNIQUE INDEX product_category_primary_idx ON catalog.product_category (tenant_id, product_id) WHERE is_primary;
SELECT kernel.enable_tenant_rls('catalog.product_category');

CREATE TABLE catalog.product_media (
  tenant_id       uuid NOT NULL REFERENCES platform.tenant(id),
  id              uuid NOT NULL DEFAULT uuidv7(),
  product_id      uuid NOT NULL,
  variant_id      uuid,                          -- Bild nur für eine Variante (Welle 2)
  media_asset_id  uuid NOT NULL,                 -- Verweis auf media.media_asset (nur ID)
  position        integer NOT NULL DEFAULT 0,
  PRIMARY KEY (tenant_id, id),
  UNIQUE (tenant_id, product_id, media_asset_id),
  FOREIGN KEY (tenant_id, product_id) REFERENCES catalog.product(tenant_id, id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, variant_id) REFERENCES catalog.variant(tenant_id, id) ON DELETE CASCADE
);
CREATE INDEX product_media_product_idx ON catalog.product_media (tenant_id, product_id, position);
SELECT kernel.enable_tenant_rls('catalog.product_media');

CREATE TABLE catalog.product_channel_listing (
  tenant_id       uuid NOT NULL REFERENCES platform.tenant(id),
  product_id      uuid NOT NULL,
  channel_id      uuid NOT NULL,                 -- Verweis auf shop_settings.sales_channel
  is_visible      boolean NOT NULL DEFAULT true,
  visible_from    timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  created_by      uuid DEFAULT kernel.current_actor_id(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  updated_by      uuid DEFAULT kernel.current_actor_id(),
  version         integer NOT NULL DEFAULT 1,
  PRIMARY KEY (tenant_id, product_id, channel_id),
  FOREIGN KEY (tenant_id, product_id) REFERENCES catalog.product(tenant_id, id) ON DELETE CASCADE
);
CREATE INDEX product_channel_listing_channel_idx ON catalog.product_channel_listing (tenant_id, channel_id, is_visible);
SELECT kernel.setup_tenant_table('catalog.product_channel_listing');

-- =============================================================================
-- 7. Schema pricing: Preise und Preisverlauf
-- =============================================================================
CREATE SCHEMA pricing;

CREATE TABLE pricing.price (
  tenant_id       uuid NOT NULL REFERENCES platform.tenant(id),
  id              uuid NOT NULL DEFAULT uuidv7(),
  variant_id      uuid NOT NULL,                 -- Verweis auf catalog.variant
  kind            text NOT NULL DEFAULT 'base' CHECK (kind IN ('base','sale','msrp')),
  currency        kernel.currency_code NOT NULL,
  amount          bigint NOT NULL CHECK (amount >= 0),
  tax_included    boolean NOT NULL DEFAULT true, -- brutto (true) oder netto (false), A-09
  channel_id      uuid,                          -- NULL = alle Kanäle
  customer_group_id uuid,                        -- NULL = alle Kundengruppen
  country_code    kernel.country_code,           -- NULL = alle Länder
  min_quantity    integer NOT NULL DEFAULT 1 CHECK (min_quantity >= 1),
  valid_from      timestamptz,                   -- NULL = seit jeher
  valid_to        timestamptz,                   -- NULL = unbegrenzt
  created_at      timestamptz NOT NULL DEFAULT now(),
  created_by      uuid DEFAULT kernel.current_actor_id(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  updated_by      uuid DEFAULT kernel.current_actor_id(),
  version         integer NOT NULL DEFAULT 1,
  PRIMARY KEY (tenant_id, id),
  CHECK (valid_to IS NULL OR valid_from IS NULL OR valid_to > valid_from),
  CONSTRAINT price_scope_unique UNIQUE NULLS NOT DISTINCT
    (tenant_id, variant_id, kind, currency, channel_id, customer_group_id, country_code, min_quantity, valid_from)
);
CREATE INDEX price_lookup_idx ON pricing.price (tenant_id, variant_id, currency);
SELECT kernel.setup_tenant_table('pricing.price');

CREATE TABLE pricing.price_history (
  tenant_id       uuid NOT NULL REFERENCES platform.tenant(id),
  id              uuid NOT NULL DEFAULT uuidv7(),
  price_id        uuid NOT NULL,
  variant_id      uuid NOT NULL,
  kind            text NOT NULL,
  currency        kernel.currency_code NOT NULL,
  amount          bigint NOT NULL,
  tax_included    boolean NOT NULL,
  channel_id      uuid,
  customer_group_id uuid,
  country_code    kernel.country_code,
  min_quantity    integer NOT NULL,
  valid_from      timestamptz,
  valid_to        timestamptz,
  change_type     text NOT NULL CHECK (change_type IN ('created','updated','deleted')),
  changed_at      timestamptz NOT NULL DEFAULT now(),
  changed_by      uuid DEFAULT kernel.current_actor_id(),
  PRIMARY KEY (tenant_id, id)
);
CREATE INDEX price_history_variant_idx ON pricing.price_history (tenant_id, variant_id, currency, changed_at);
SELECT kernel.enable_tenant_rls('pricing.price_history');
SELECT kernel.make_append_only('pricing.price_history');

-- Jede Preisänderung landet automatisch im Verlauf (A-03)
CREATE FUNCTION pricing.tg_record_price_history() RETURNS trigger
  LANGUAGE plpgsql AS $$
DECLARE
  r pricing.price;
BEGIN
  r := CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  INSERT INTO pricing.price_history
    (tenant_id, price_id, variant_id, kind, currency, amount, tax_included, channel_id,
     customer_group_id, country_code, min_quantity, valid_from, valid_to, change_type)
  VALUES
    (r.tenant_id, r.id, r.variant_id, r.kind, r.currency, r.amount, r.tax_included, r.channel_id,
     r.customer_group_id, r.country_code, r.min_quantity, r.valid_from, r.valid_to,
     CASE TG_OP WHEN 'INSERT' THEN 'created' WHEN 'UPDATE' THEN 'updated' ELSE 'deleted' END);
  RETURN NULL;
END $$;
CREATE TRIGGER price_history AFTER INSERT OR DELETE OR UPDATE OF
  amount, kind, currency, tax_included, channel_id, customer_group_id, country_code,
  min_quantity, valid_from, valid_to
  ON pricing.price FOR EACH ROW EXECUTE FUNCTION pricing.tg_record_price_history();

-- Niedrigster Preis der letzten p_days Tage für Endkunden ohne Sonderbedingungen (STR-12).
-- Berücksichtigt den Preis, der zu Beginn des Zeitfensters galt, und alle Änderungen danach.
-- Vereinfachte Fassung, Feinheiten (geplante Preise) werden in Welle 2 geprüft.
CREATE FUNCTION pricing.lowest_price(p_variant uuid, p_currency kernel.currency_code,
                                     p_channel uuid DEFAULT NULL, p_days integer DEFAULT 30,
                                     p_at timestamptz DEFAULT now())
  RETURNS bigint LANGUAGE sql STABLE AS $$
  WITH h AS (
    SELECT price_id, amount, change_type, changed_at
      FROM pricing.price_history
     WHERE tenant_id = kernel.current_tenant_id()
       AND variant_id = p_variant AND currency = p_currency
       AND kind IN ('base','sale')
       AND (channel_id IS NULL OR channel_id = p_channel)
       AND customer_group_id IS NULL AND country_code IS NULL AND min_quantity = 1
       AND changed_at <= p_at
  ), at_window_start AS (       -- letzter Stand jeder Preiszeile vor dem Fenster
    SELECT DISTINCT ON (price_id) price_id, amount, change_type
      FROM h WHERE changed_at <= p_at - make_interval(days => p_days)
     ORDER BY price_id, changed_at DESC
  )
  SELECT min(amount) FROM (
    SELECT amount FROM at_window_start WHERE change_type <> 'deleted'
    UNION ALL
    SELECT amount FROM h WHERE changed_at > p_at - make_interval(days => p_days)
                          AND change_type <> 'deleted'
  ) x
$$;

-- =============================================================================
-- 8. Schema tax: Steuerklassen und Steuersätze (global), Einstellungen je Shop
-- =============================================================================
CREATE SCHEMA tax;

CREATE TABLE tax.tax_class (
  code            text PRIMARY KEY CHECK (code ~ '^[a-z_]+$'),
  name_de         text NOT NULL,
  description     text,
  position        integer NOT NULL DEFAULT 0
);

CREATE TABLE tax.tax_rate (
  id              uuid PRIMARY KEY DEFAULT uuidv7(),
  country_code    kernel.country_code NOT NULL,
  region_code     text NOT NULL DEFAULT '',      -- '' = ganzes Land
  tax_class_code  text NOT NULL REFERENCES tax.tax_class(code),
  rate_bp         kernel.rate_bp NOT NULL,       -- 1900 = 19 Prozent
  vat_category_code text NOT NULL CHECK (vat_category_code IN ('S','Z','E','AE','K','G','O','L','M')),
  valid_from      date NOT NULL,
  valid_to        date,                          -- einschließlich, NULL = unbegrenzt
  legal_reference text,
  CHECK (valid_to IS NULL OR valid_to >= valid_from),
  EXCLUDE USING gist (country_code WITH =, region_code WITH =, tax_class_code WITH =,
                      daterange(valid_from, valid_to, '[]') WITH &&)
);

CREATE TABLE tax.tenant_tax_setting (
  tenant_id       uuid NOT NULL REFERENCES platform.tenant(id),
  id              uuid NOT NULL DEFAULT uuidv7(),
  home_country    kernel.country_code NOT NULL DEFAULT 'DE',
  prices_include_tax boolean NOT NULL DEFAULT true,
  small_business_regime boolean NOT NULL DEFAULT false,  -- Kleinunternehmerregelung § 19 UStG
  oss_enabled     boolean NOT NULL DEFAULT false,        -- vorbereitet, genutzt ab Welle 4 (STR-15)
  shipping_tax_mode text NOT NULL DEFAULT 'proportional'
                    CHECK (shipping_tax_mode IN ('proportional','highest_rate','fixed_class')),
  shipping_tax_class_code text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  created_by      uuid DEFAULT kernel.current_actor_id(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  updated_by      uuid DEFAULT kernel.current_actor_id(),
  version         integer NOT NULL DEFAULT 1,
  PRIMARY KEY (tenant_id, id),
  UNIQUE (tenant_id)
);
SELECT kernel.setup_tenant_table('tax.tenant_tax_setting');

-- =============================================================================
-- 9. Schema inventory: Lagerorte, Bestand, Reservierungen, Bewegungen
-- =============================================================================
CREATE SCHEMA inventory;

CREATE TABLE inventory.stock_location (
  tenant_id       uuid NOT NULL REFERENCES platform.tenant(id),
  id              uuid NOT NULL DEFAULT uuidv7(),
  code            text NOT NULL,
  name            text NOT NULL,
  is_default      boolean NOT NULL DEFAULT false,
  kind            text NOT NULL DEFAULT 'warehouse' CHECK (kind IN ('warehouse','store','dropship')),
  allows_pickup   boolean NOT NULL DEFAULT false, -- Click and Collect (Welle 5)
  address_line1   text,
  postal_code     text,
  city            text,
  country_code    kernel.country_code,
  status          text NOT NULL DEFAULT 'active' CHECK (status IN ('active','disabled')),
  created_at      timestamptz NOT NULL DEFAULT now(),
  created_by      uuid DEFAULT kernel.current_actor_id(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  updated_by      uuid DEFAULT kernel.current_actor_id(),
  version         integer NOT NULL DEFAULT 1,
  PRIMARY KEY (tenant_id, id),
  UNIQUE (tenant_id, code)
);
CREATE UNIQUE INDEX stock_location_default_idx ON inventory.stock_location (tenant_id) WHERE is_default;
SELECT kernel.setup_tenant_table('inventory.stock_location');

CREATE TABLE inventory.stock_level (
  tenant_id       uuid NOT NULL REFERENCES platform.tenant(id),
  variant_id      uuid NOT NULL,                 -- Verweis auf catalog.variant
  location_id     uuid NOT NULL,
  on_hand         integer NOT NULL DEFAULT 0 CHECK (on_hand >= 0),
  reserved        integer NOT NULL DEFAULT 0 CHECK (reserved >= 0),
  available       integer GENERATED ALWAYS AS (on_hand - reserved) STORED,
  allow_oversell  boolean NOT NULL DEFAULT false,
  low_stock_threshold integer CHECK (low_stock_threshold >= 0),
  created_at      timestamptz NOT NULL DEFAULT now(),
  created_by      uuid DEFAULT kernel.current_actor_id(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  updated_by      uuid DEFAULT kernel.current_actor_id(),
  version         integer NOT NULL DEFAULT 1,
  PRIMARY KEY (tenant_id, variant_id, location_id),
  FOREIGN KEY (tenant_id, location_id) REFERENCES inventory.stock_location(tenant_id, id),
  CONSTRAINT stock_level_no_oversell CHECK (allow_oversell OR reserved <= on_hand)
);
CREATE INDEX stock_level_location_idx ON inventory.stock_level (tenant_id, location_id);
SELECT kernel.setup_tenant_table('inventory.stock_level');

CREATE TABLE inventory.reservation (
  tenant_id       uuid NOT NULL REFERENCES platform.tenant(id),
  id              uuid NOT NULL DEFAULT uuidv7(),
  variant_id      uuid NOT NULL,
  location_id     uuid NOT NULL,
  quantity        integer NOT NULL CHECK (quantity > 0),
  reference_type  text NOT NULL CHECK (reference_type IN ('checkout','order')),
  reference_id    uuid NOT NULL,
  status          text NOT NULL DEFAULT 'active' CHECK (status IN ('active','committed','released','expired')),
  expires_at      timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  created_by      uuid DEFAULT kernel.current_actor_id(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  updated_by      uuid DEFAULT kernel.current_actor_id(),
  version         integer NOT NULL DEFAULT 1,
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, variant_id, location_id)
    REFERENCES inventory.stock_level(tenant_id, variant_id, location_id)
);
CREATE INDEX reservation_reference_idx ON inventory.reservation (tenant_id, reference_type, reference_id);
CREATE INDEX reservation_active_expiry_idx ON inventory.reservation (tenant_id, expires_at) WHERE status = 'active';
SELECT kernel.setup_tenant_table('inventory.reservation');

CREATE TABLE inventory.stock_movement (
  tenant_id       uuid NOT NULL REFERENCES platform.tenant(id),
  id              uuid NOT NULL DEFAULT uuidv7(),
  variant_id      uuid NOT NULL,
  location_id     uuid NOT NULL,
  quantity_delta  integer NOT NULL CHECK (quantity_delta <> 0),
  reason          text NOT NULL CHECK (reason IN ('initial','adjustment','sale','cancellation','return','correction','transfer_in','transfer_out','loss')),
  reference_type  text,
  reference_id    uuid,
  note            text,
  occurred_at     timestamptz NOT NULL DEFAULT now(),
  actor_id        uuid DEFAULT kernel.current_actor_id(),
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, variant_id, location_id)
    REFERENCES inventory.stock_level(tenant_id, variant_id, location_id)
);
CREATE INDEX stock_movement_variant_idx ON inventory.stock_movement (tenant_id, variant_id, occurred_at);
SELECT kernel.enable_tenant_rls('inventory.stock_movement');
SELECT kernel.make_append_only('inventory.stock_movement');

CREATE TABLE inventory.processed_event (
  tenant_id       uuid NOT NULL REFERENCES platform.tenant(id),
  event_id        uuid NOT NULL,
  subscriber      text NOT NULL,
  processed_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, subscriber, event_id)
);
SELECT kernel.enable_tenant_rls('inventory.processed_event');

-- =============================================================================
-- 10. Schema customers: Kunden, Gruppen, Adressen, Firmen (B2B), Einwilligungen
-- =============================================================================
CREATE SCHEMA customers;

CREATE TABLE customers.customer_group (
  tenant_id       uuid NOT NULL REFERENCES platform.tenant(id),
  id              uuid NOT NULL DEFAULT uuidv7(),
  code            text NOT NULL,                 -- 'consumers' = Standardgruppe "Endkunden"
  name            text NOT NULL,
  is_default      boolean NOT NULL DEFAULT false,
  tax_display     text NOT NULL DEFAULT 'gross' CHECK (tax_display IN ('gross','net')),
  min_order_amount bigint CHECK (min_order_amount >= 0),     -- Welle 3 (WKC-05)
  min_order_currency kernel.currency_code,
  created_at      timestamptz NOT NULL DEFAULT now(),
  created_by      uuid DEFAULT kernel.current_actor_id(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  updated_by      uuid DEFAULT kernel.current_actor_id(),
  version         integer NOT NULL DEFAULT 1,
  PRIMARY KEY (tenant_id, id),
  UNIQUE (tenant_id, code),
  CHECK ((min_order_amount IS NULL) = (min_order_currency IS NULL))
);
CREATE UNIQUE INDEX customer_group_default_idx ON customers.customer_group (tenant_id) WHERE is_default;
SELECT kernel.setup_tenant_table('customers.customer_group');

CREATE TABLE customers.company (                  -- vorbereitet, genutzt ab Welle 3 (B2B-01)
  tenant_id       uuid NOT NULL REFERENCES platform.tenant(id),
  id              uuid NOT NULL DEFAULT uuidv7(),
  name            text NOT NULL,
  legal_name      text,
  vat_id          text,                          -- USt-IdNr.
  vat_id_verified_at timestamptz,
  vat_id_check_result jsonb,                     -- Antwort der VIES-Prüfung
  tax_number      text,
  buyer_reference text,                          -- Standard-Leitweg-ID für E-Rechnungen
  customer_group_id uuid,
  payment_terms_days smallint CHECK (payment_terms_days >= 0),
  credit_limit_amount bigint CHECK (credit_limit_amount >= 0),
  credit_limit_currency kernel.currency_code,
  status          text NOT NULL DEFAULT 'active' CHECK (status IN ('pending','active','blocked','archived')),
  custom_fields   jsonb NOT NULL DEFAULT '{}'::jsonb,
  archived_at     timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  created_by      uuid DEFAULT kernel.current_actor_id(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  updated_by      uuid DEFAULT kernel.current_actor_id(),
  version         integer NOT NULL DEFAULT 1,
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, customer_group_id) REFERENCES customers.customer_group(tenant_id, id),
  CHECK ((credit_limit_amount IS NULL) = (credit_limit_currency IS NULL))
);
SELECT kernel.setup_tenant_table('customers.company');

CREATE TABLE customers.customer (
  tenant_id       uuid NOT NULL REFERENCES platform.tenant(id),
  id              uuid NOT NULL DEFAULT uuidv7(),
  customer_number text,                          -- aus Nummernkreis 'customer'
  kind            text NOT NULL DEFAULT 'guest' CHECK (kind IN ('guest','registered')),
  account_status  text NOT NULL DEFAULT 'none' CHECK (account_status IN ('none','invited','active','disabled')),
  email           text,
  email_normalized text GENERATED ALWAYS AS (lower(email)) STORED,
  first_name      text,
  last_name       text,
  phone           text,
  preferred_locale kernel.locale_code NOT NULL DEFAULT 'de',
  company_id      uuid,                          -- A-11, in Welle 1 immer leer
  default_billing_address_id  uuid,
  default_shipping_address_id uuid,
  custom_fields   jsonb NOT NULL DEFAULT '{}'::jsonb,
  anonymized_at   timestamptz,
  archived_at     timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  created_by      uuid DEFAULT kernel.current_actor_id(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  updated_by      uuid DEFAULT kernel.current_actor_id(),
  version         integer NOT NULL DEFAULT 1,
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, company_id) REFERENCES customers.company(tenant_id, id),
  CHECK (anonymized_at IS NOT NULL OR email IS NOT NULL)
);
CREATE UNIQUE INDEX customer_email_idx ON customers.customer (tenant_id, email_normalized)
  WHERE anonymized_at IS NULL;
CREATE UNIQUE INDEX customer_number_idx ON customers.customer (tenant_id, customer_number)
  WHERE customer_number IS NOT NULL;
CREATE INDEX customer_company_idx ON customers.customer (tenant_id, company_id);
SELECT kernel.setup_tenant_table('customers.customer');

CREATE TABLE customers.customer_group_member (
  tenant_id       uuid NOT NULL REFERENCES platform.tenant(id),
  customer_group_id uuid NOT NULL,
  customer_id     uuid NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, customer_group_id, customer_id),
  FOREIGN KEY (tenant_id, customer_group_id) REFERENCES customers.customer_group(tenant_id, id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, customer_id) REFERENCES customers.customer(tenant_id, id) ON DELETE CASCADE
);
CREATE INDEX customer_group_member_customer_idx ON customers.customer_group_member (tenant_id, customer_id);
SELECT kernel.enable_tenant_rls('customers.customer_group_member');

CREATE TABLE customers.company_member (            -- vorbereitet, genutzt ab Welle 3
  tenant_id       uuid NOT NULL REFERENCES platform.tenant(id),
  company_id      uuid NOT NULL,
  customer_id     uuid NOT NULL,
  role            text NOT NULL DEFAULT 'buyer' CHECK (role IN ('admin','buyer','approver','viewer')),
  spending_limit_amount bigint CHECK (spending_limit_amount >= 0),
  status          text NOT NULL DEFAULT 'active' CHECK (status IN ('invited','active','disabled')),
  created_at      timestamptz NOT NULL DEFAULT now(),
  created_by      uuid DEFAULT kernel.current_actor_id(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  updated_by      uuid DEFAULT kernel.current_actor_id(),
  version         integer NOT NULL DEFAULT 1,
  PRIMARY KEY (tenant_id, company_id, customer_id),
  FOREIGN KEY (tenant_id, company_id) REFERENCES customers.company(tenant_id, id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, customer_id) REFERENCES customers.customer(tenant_id, id) ON DELETE CASCADE
);
CREATE INDEX company_member_customer_idx ON customers.company_member (tenant_id, customer_id);
SELECT kernel.setup_tenant_table('customers.company_member');

CREATE TABLE customers.customer_address (
  tenant_id       uuid NOT NULL REFERENCES platform.tenant(id),
  id              uuid NOT NULL DEFAULT uuidv7(),
  customer_id     uuid,
  company_id      uuid,                          -- Lieferadressen einer Firma (Welle 3)
  label           text,
  first_name      text,
  last_name       text,
  company_name    text,
  address_line1   text NOT NULL,
  address_line2   text,
  postal_code     text,
  city            text NOT NULL,
  region_code     text,
  country_code    kernel.country_code NOT NULL,
  phone           text,
  extra           jsonb NOT NULL DEFAULT '{}'::jsonb,   -- länderspezifische Felder (A-12)
  created_at      timestamptz NOT NULL DEFAULT now(),
  created_by      uuid DEFAULT kernel.current_actor_id(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  updated_by      uuid DEFAULT kernel.current_actor_id(),
  version         integer NOT NULL DEFAULT 1,
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, customer_id) REFERENCES customers.customer(tenant_id, id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, company_id) REFERENCES customers.company(tenant_id, id) ON DELETE CASCADE,
  CHECK (customer_id IS NOT NULL OR company_id IS NOT NULL)
);
CREATE INDEX customer_address_customer_idx ON customers.customer_address (tenant_id, customer_id);
CREATE INDEX customer_address_company_idx ON customers.customer_address (tenant_id, company_id);
SELECT kernel.setup_tenant_table('customers.customer_address');

CREATE TABLE customers.consent_event (
  tenant_id       uuid NOT NULL REFERENCES platform.tenant(id),
  id              uuid NOT NULL DEFAULT uuidv7(),
  customer_id     uuid,
  email_hash      bytea,                         -- für Gäste ohne Kundendatensatz
  purpose         text NOT NULL CHECK (purpose IN ('newsletter','cart_reminder','review_request','marketing_profiling','terms_acceptance')),
  action          text NOT NULL CHECK (action IN ('granted','confirmed','withdrawn')),
  source          text NOT NULL CHECK (source IN ('checkout','account','double_opt_in','merchant','import')),
  legal_text_version_id uuid,                    -- Verweis auf content.legal_document_version
  wording         text,                          -- angezeigter Einwilligungstext
  ip_hash         bytea,
  occurred_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, customer_id) REFERENCES customers.customer(tenant_id, id),
  CHECK (customer_id IS NOT NULL OR email_hash IS NOT NULL)
);
CREATE INDEX consent_event_customer_idx ON customers.consent_event (tenant_id, customer_id, purpose, occurred_at);
SELECT kernel.enable_tenant_rls('customers.consent_event');
SELECT kernel.make_append_only('customers.consent_event');

CREATE TABLE customers.processed_event (
  tenant_id       uuid NOT NULL REFERENCES platform.tenant(id),
  event_id        uuid NOT NULL,
  subscriber      text NOT NULL,
  processed_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, subscriber, event_id)
);
SELECT kernel.enable_tenant_rls('customers.processed_event');

-- =============================================================================
-- 11. Schema cart: Warenkorb
-- =============================================================================
CREATE SCHEMA cart;

CREATE TABLE cart.cart (
  tenant_id       uuid NOT NULL REFERENCES platform.tenant(id),
  id              uuid NOT NULL DEFAULT uuidv7(),
  token_hash      bytea NOT NULL,                -- Hash des Warenkorb-Cookies
  channel_id      uuid NOT NULL,
  customer_id     uuid,
  customer_group_id uuid,
  currency        kernel.currency_code NOT NULL DEFAULT 'EUR',
  locale          kernel.locale_code NOT NULL DEFAULT 'de',
  country_code    kernel.country_code NOT NULL DEFAULT 'DE',
  status          text NOT NULL DEFAULT 'active' CHECK (status IN ('active','frozen','converted','abandoned')),
  last_activity_at timestamptz NOT NULL DEFAULT now(),
  expires_at      timestamptz NOT NULL DEFAULT now() + interval '30 days',
  created_at      timestamptz NOT NULL DEFAULT now(),
  created_by      uuid DEFAULT kernel.current_actor_id(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  updated_by      uuid DEFAULT kernel.current_actor_id(),
  version         integer NOT NULL DEFAULT 1,
  PRIMARY KEY (tenant_id, id),
  UNIQUE (tenant_id, token_hash)
);
CREATE INDEX cart_expiry_idx ON cart.cart (tenant_id, expires_at) WHERE status = 'active';
CREATE INDEX cart_customer_idx ON cart.cart (tenant_id, customer_id);
SELECT kernel.setup_tenant_table('cart.cart');

CREATE TABLE cart.cart_line (
  tenant_id       uuid NOT NULL REFERENCES platform.tenant(id),
  id              uuid NOT NULL DEFAULT uuidv7(),
  cart_id         uuid NOT NULL,
  variant_id      uuid NOT NULL,
  line_key        text NOT NULL,                 -- Variante plus Personalisierung, verhindert Doppelzeilen
  quantity        integer NOT NULL CHECK (quantity BETWEEN 1 AND 9999),
  added_unit_amount bigint,                      -- Preis beim Hineinlegen, für Hinweis bei Preisänderung
  custom_input    jsonb,                         -- Personalisierung (Welle 5)
  position        integer NOT NULL DEFAULT 0,
  created_at      timestamptz NOT NULL DEFAULT now(),
  created_by      uuid DEFAULT kernel.current_actor_id(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  updated_by      uuid DEFAULT kernel.current_actor_id(),
  version         integer NOT NULL DEFAULT 1,
  PRIMARY KEY (tenant_id, id),
  UNIQUE (tenant_id, cart_id, line_key),
  FOREIGN KEY (tenant_id, cart_id) REFERENCES cart.cart(tenant_id, id) ON DELETE CASCADE
);
SELECT kernel.setup_tenant_table('cart.cart_line');

-- =============================================================================
-- 12. Schema checkout: Ablauf vom Warenkorb zur Bestellung
-- =============================================================================
CREATE SCHEMA checkout;

CREATE TABLE checkout.checkout_session (
  tenant_id       uuid NOT NULL REFERENCES platform.tenant(id),
  id              uuid NOT NULL DEFAULT uuidv7(),
  cart_id         uuid NOT NULL,
  channel_id      uuid NOT NULL,
  status          text NOT NULL DEFAULT 'open' CHECK (status IN ('open','placing','completed','abandoned','expired')),
  email           text,
  billing_address jsonb,
  shipping_address jsonb,
  shipping_method_id uuid,
  payment_method_config_id uuid,
  customer_note   text,
  totals_preview  jsonb,                         -- zuletzt angezeigte Summen (nur Anzeige)
  order_id        uuid,
  expires_at      timestamptz NOT NULL DEFAULT now() + interval '2 hours',
  completed_at    timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  created_by      uuid DEFAULT kernel.current_actor_id(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  updated_by      uuid DEFAULT kernel.current_actor_id(),
  version         integer NOT NULL DEFAULT 1,
  PRIMARY KEY (tenant_id, id)
);
CREATE UNIQUE INDEX checkout_session_open_cart_idx ON checkout.checkout_session (tenant_id, cart_id)
  WHERE status IN ('open','placing');
SELECT kernel.setup_tenant_table('checkout.checkout_session');

-- =============================================================================
-- 13. Schema orders: unveränderliche Bestellungen, Zeitleiste, Widerruf
-- =============================================================================
CREATE SCHEMA orders;

CREATE TABLE orders."order" (
  tenant_id       uuid NOT NULL REFERENCES platform.tenant(id),
  id              uuid NOT NULL DEFAULT uuidv7(),
  order_number    text NOT NULL,                 -- lückenlos je Shop (Nummernkreis 'order')
  channel_id      uuid NOT NULL,
  checkout_session_id uuid,
  customer_id     uuid,
  company_id      uuid,                          -- B2B, ab Welle 3
  customer_group_id uuid,
  email           text,
  phone           text,
  locale          kernel.locale_code NOT NULL,
  currency        kernel.currency_code NOT NULL,
  tax_display     text NOT NULL CHECK (tax_display IN ('gross','net')),
  small_business_regime boolean NOT NULL DEFAULT false,
  -- Summen (Momentaufnahme, in Cent)
  subtotal_amount bigint NOT NULL,
  shipping_amount bigint NOT NULL DEFAULT 0,
  discount_amount bigint NOT NULL DEFAULT 0,
  tax_amount      bigint NOT NULL,
  total_amount    bigint NOT NULL CHECK (total_amount >= 0),
  -- Versand- und Zahlart (Momentaufnahme)
  shipping_method_id uuid,
  shipping_method_name text,
  payment_method_config_id uuid,
  payment_method_name text,
  payment_provider text,
  -- B2B und E-Rechnung (Welle 3)
  buyer_vat_id    text,
  buyer_reference text,                          -- Leitweg-ID oder Bestellreferenz des Käufers
  payment_terms_days smallint,
  -- veränderliche Felder
  status          text NOT NULL DEFAULT 'pending_payment'
                    CHECK (status IN ('pending_payment','open','in_progress','completed','cancelled')),
  payment_status  text NOT NULL DEFAULT 'unpaid'
                    CHECK (payment_status IN ('unpaid','authorized','paid','partially_refunded','refunded','failed')),
  fulfillment_status text NOT NULL DEFAULT 'unfulfilled'
                    CHECK (fulfillment_status IN ('unfulfilled','partially_shipped','shipped','delivered','partially_returned','returned')),
  customer_note   text,
  merchant_note   text,
  seen_at         timestamptz,                   -- "unbearbeitet" hervorheben (BST-04)
  cancelled_at    timestamptz,
  cancel_reason   text,
  custom_fields   jsonb NOT NULL DEFAULT '{}'::jsonb,
  anonymized_at   timestamptz,
  placed_at       timestamptz NOT NULL DEFAULT now(),
  created_at      timestamptz NOT NULL DEFAULT now(),
  created_by      uuid DEFAULT kernel.current_actor_id(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  updated_by      uuid DEFAULT kernel.current_actor_id(),
  version         integer NOT NULL DEFAULT 1,
  PRIMARY KEY (tenant_id, id),
  UNIQUE (tenant_id, order_number),
  CHECK (total_amount = subtotal_amount + shipping_amount - discount_amount
                        + CASE WHEN tax_display = 'net' THEN tax_amount ELSE 0 END)
);
CREATE INDEX order_placed_idx ON orders."order" (tenant_id, placed_at DESC);
CREATE INDEX order_status_idx ON orders."order" (tenant_id, status, payment_status, fulfillment_status);
CREATE INDEX order_customer_idx ON orders."order" (tenant_id, customer_id);
CREATE INDEX order_unseen_idx ON orders."order" (tenant_id, placed_at) WHERE seen_at IS NULL;
SELECT kernel.setup_tenant_table('orders."order"');

-- Die Bestellung ist eine Momentaufnahme: nur Status, Notizen und Zusatzfelder ändern sich.
CREATE FUNCTION orders.tg_order_guard() RETURNS trigger
  LANGUAGE plpgsql AS $$
DECLARE
  changeable text[] := ARRAY['status','payment_status','fulfillment_status','merchant_note','seen_at',
                             'cancelled_at','cancel_reason','custom_fields',
                             'updated_at','updated_by','version'];
  personal   text[] := ARRAY['email','phone','customer_note','anonymized_at'];
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Bestellungen werden nie gelöscht' USING ERRCODE = 'P0001';
  END IF;
  -- Beim Anonymisieren (DSGVO) dürfen zusätzlich die persönlichen Felder geleert werden
  IF NEW.anonymized_at IS NOT NULL AND OLD.anonymized_at IS NULL THEN
    changeable := changeable || personal;
  END IF;
  IF (to_jsonb(NEW) - changeable) IS DISTINCT FROM (to_jsonb(OLD) - changeable) THEN
    RAISE EXCEPTION 'Bestellung % ist eine unveränderliche Momentaufnahme', OLD.order_number
      USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER aa_order_guard BEFORE UPDATE OR DELETE ON orders."order"
  FOR EACH ROW EXECUTE FUNCTION orders.tg_order_guard();

CREATE TABLE orders.order_line (
  tenant_id       uuid NOT NULL REFERENCES platform.tenant(id),
  id              uuid NOT NULL DEFAULT uuidv7(),
  order_id        uuid NOT NULL,
  position        integer NOT NULL,
  product_id      uuid NOT NULL,
  variant_id      uuid NOT NULL,
  sku             text,
  product_name    text NOT NULL,
  variant_title   text,
  key_features    text,                          -- wesentliche Merkmale zum Kaufzeitpunkt
  quantity        integer NOT NULL CHECK (quantity > 0),
  unit_price_amount bigint NOT NULL,
  unit_price_includes_tax boolean NOT NULL,
  line_subtotal_amount bigint NOT NULL,
  discount_amount bigint NOT NULL DEFAULT 0,
  tax_class_code  text NOT NULL,
  tax_rate_bp     kernel.rate_bp NOT NULL,
  vat_category_code text NOT NULL,
  tax_amount      bigint NOT NULL,
  line_total_amount bigint NOT NULL,
  unit_pricing    jsonb,                         -- Grundpreis-Angaben zum Kaufzeitpunkt
  delivery_time_text text,
  withdrawal_exclusion text,
  manufacturer_snapshot jsonb,                   -- GPSR-Angaben zum Kaufzeitpunkt
  image_media_id  uuid,
  custom_input    jsonb,
  created_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  UNIQUE (tenant_id, order_id, position),
  FOREIGN KEY (tenant_id, order_id) REFERENCES orders."order"(tenant_id, id)
);
CREATE INDEX order_line_variant_idx ON orders.order_line (tenant_id, variant_id);
SELECT kernel.enable_tenant_rls('orders.order_line');
SELECT kernel.make_append_only('orders.order_line');

CREATE TABLE orders.order_address (
  tenant_id       uuid NOT NULL REFERENCES platform.tenant(id),
  id              uuid NOT NULL DEFAULT uuidv7(),
  order_id        uuid NOT NULL,
  kind            text NOT NULL CHECK (kind IN ('billing','shipping')),
  first_name      text,
  last_name       text,
  company_name    text,
  address_line1   text,
  address_line2   text,
  postal_code     text,
  city            text,
  region_code     text,
  country_code    kernel.country_code NOT NULL,
  phone           text,
  extra           jsonb NOT NULL DEFAULT '{}'::jsonb,
  anonymized_at   timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  UNIQUE (tenant_id, order_id, kind),
  FOREIGN KEY (tenant_id, order_id) REFERENCES orders."order"(tenant_id, id)
);
SELECT kernel.enable_tenant_rls('orders.order_address');

-- Adressen bleiben unverändert, außer beim Anonymisieren
CREATE FUNCTION orders.tg_order_address_guard() RETURNS trigger
  LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' OR NEW.anonymized_at IS NULL OR OLD.anonymized_at IS NOT NULL
     OR NEW.order_id <> OLD.order_id OR NEW.kind <> OLD.kind OR NEW.country_code <> OLD.country_code THEN
    RAISE EXCEPTION 'Bestelladresse ist unveränderlich (nur Anonymisierung erlaubt)' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER aa_order_address_guard BEFORE UPDATE OR DELETE ON orders.order_address
  FOR EACH ROW EXECUTE FUNCTION orders.tg_order_address_guard();

CREATE TABLE orders.order_tax_line (
  tenant_id       uuid NOT NULL REFERENCES platform.tenant(id),
  id              uuid NOT NULL DEFAULT uuidv7(),
  order_id        uuid NOT NULL,
  tax_class_code  text NOT NULL,
  rate_bp         kernel.rate_bp NOT NULL,
  vat_category_code text NOT NULL,
  country_code    kernel.country_code NOT NULL,
  taxable_amount  bigint NOT NULL,               -- Nettobetrag dieser Steuergruppe
  tax_amount      bigint NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, order_id) REFERENCES orders."order"(tenant_id, id)
);
CREATE INDEX order_tax_line_order_idx ON orders.order_tax_line (tenant_id, order_id);
SELECT kernel.enable_tenant_rls('orders.order_tax_line');
SELECT kernel.make_append_only('orders.order_tax_line');

CREATE TABLE orders.order_legal_acceptance (
  tenant_id       uuid NOT NULL REFERENCES platform.tenant(id),
  id              uuid NOT NULL DEFAULT uuidv7(),
  order_id        uuid NOT NULL,
  document_type   text NOT NULL,                 -- 'terms', 'withdrawal_policy', 'privacy', ...
  legal_document_version_id uuid NOT NULL,       -- Verweis auf content.legal_document_version
  version_number  integer NOT NULL,
  content_hash    bytea NOT NULL,                -- SHA-256 des Textes, beweist den genauen Inhalt
  acceptance      text NOT NULL CHECK (acceptance IN ('checkbox','notice','sent_with_confirmation')),
  accepted_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  UNIQUE (tenant_id, order_id, document_type),
  FOREIGN KEY (tenant_id, order_id) REFERENCES orders."order"(tenant_id, id)
);
SELECT kernel.enable_tenant_rls('orders.order_legal_acceptance');
SELECT kernel.make_append_only('orders.order_legal_acceptance');

CREATE TABLE orders.order_event (
  tenant_id       uuid NOT NULL REFERENCES platform.tenant(id),
  id              uuid NOT NULL DEFAULT uuidv7(),
  order_id        uuid NOT NULL,
  type            text NOT NULL,                 -- 'placed', 'paid', 'shipped', 'note', 'withdrawal_received', ...
  data            jsonb NOT NULL DEFAULT '{}'::jsonb,
  actor_type      text NOT NULL CHECK (actor_type IN ('customer','user','api_token','ai','app','system')),
  actor_id        uuid,
  occurred_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, order_id) REFERENCES orders."order"(tenant_id, id)
);
CREATE INDEX order_event_order_idx ON orders.order_event (tenant_id, order_id, occurred_at);
SELECT kernel.enable_tenant_rls('orders.order_event');
SELECT kernel.make_append_only('orders.order_event');

CREATE TABLE orders.withdrawal (
  tenant_id       uuid NOT NULL REFERENCES platform.tenant(id),
  id              uuid NOT NULL DEFAULT uuidv7(),
  withdrawal_number text,                        -- aus Nummernkreis 'withdrawal'
  order_id        uuid,                          -- NULL, solange die Erklärung keiner Bestellung zugeordnet ist
  channel         text NOT NULL CHECK (channel IN ('button','form','email','letter','phone','merchant')),
  -- Angaben, wie sie der Kunde gemacht hat (Beweis)
  entered_order_number text,
  entered_email   text,
  entered_name    text,
  statement       text,                          -- Erklärungstext, z. B. "Ich widerrufe ..."
  scope           text NOT NULL DEFAULT 'full' CHECK (scope IN ('full','partial')),
  status          text NOT NULL DEFAULT 'received'
                    CHECK (status IN ('received','confirmed','processing','completed','rejected')),
  received_at     timestamptz NOT NULL DEFAULT now(),  -- maßgeblich für die Frist
  confirmation_sent_at timestamptz,              -- Eingangsbestätigung auf dauerhaftem Datenträger
  completed_at    timestamptz,
  rejection_reason text,
  ip_hash         bytea,
  user_agent_hash bytea,
  created_at      timestamptz NOT NULL DEFAULT now(),
  created_by      uuid DEFAULT kernel.current_actor_id(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  updated_by      uuid DEFAULT kernel.current_actor_id(),
  version         integer NOT NULL DEFAULT 1,
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, order_id) REFERENCES orders."order"(tenant_id, id)
);
CREATE INDEX withdrawal_order_idx ON orders.withdrawal (tenant_id, order_id);
CREATE INDEX withdrawal_open_idx ON orders.withdrawal (tenant_id, received_at) WHERE status IN ('received','confirmed','processing');
CREATE UNIQUE INDEX withdrawal_number_idx ON orders.withdrawal (tenant_id, withdrawal_number) WHERE withdrawal_number IS NOT NULL;
SELECT kernel.setup_tenant_table('orders.withdrawal');

CREATE TABLE orders.withdrawal_line (
  tenant_id       uuid NOT NULL REFERENCES platform.tenant(id),
  withdrawal_id   uuid NOT NULL,
  order_line_id   uuid NOT NULL,
  quantity        integer NOT NULL CHECK (quantity > 0),
  PRIMARY KEY (tenant_id, withdrawal_id, order_line_id),
  FOREIGN KEY (tenant_id, withdrawal_id) REFERENCES orders.withdrawal(tenant_id, id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, order_line_id) REFERENCES orders.order_line(tenant_id, id)
);
SELECT kernel.enable_tenant_rls('orders.withdrawal_line');

CREATE TABLE orders.processed_event (
  tenant_id       uuid NOT NULL REFERENCES platform.tenant(id),
  event_id        uuid NOT NULL,
  subscriber      text NOT NULL,
  processed_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, subscriber, event_id)
);
SELECT kernel.enable_tenant_rls('orders.processed_event');

-- =============================================================================
-- 14. Schema invoicing: Rechnungen und Gutschriften (vorbereitet, genutzt ab Welle 2,
--     E-Rechnung ab Welle 3)
-- =============================================================================
CREATE SCHEMA invoicing;

CREATE TABLE invoicing.invoice (
  tenant_id       uuid NOT NULL REFERENCES platform.tenant(id),
  id              uuid NOT NULL DEFAULT uuidv7(),
  document_type   text NOT NULL CHECK (document_type IN ('invoice','credit_note','cancellation','correction')),
  invoice_number  text,                          -- erst beim Ausstellen vergeben (lückenlos)
  status          text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','issued')),
  order_id        uuid NOT NULL,                 -- Verweis auf orders.order
  related_invoice_id uuid,                       -- ursprüngliche Rechnung bei Storno/Gutschrift
  issue_date      date,
  service_date_from date,                        -- Leistungsdatum oder -zeitraum
  service_date_to date,
  currency        kernel.currency_code NOT NULL,
  net_amount      bigint NOT NULL,
  tax_amount      bigint NOT NULL,
  gross_amount    bigint NOT NULL,
  seller          jsonb NOT NULL,                -- Name, Anschrift, USt-IdNr., Steuernummer (Momentaufnahme)
  buyer           jsonb NOT NULL,                -- Name, Anschrift
  buyer_vat_id    text,                          -- USt-IdNr. des Käufers
  buyer_reference text,                          -- Leitweg-ID (BT-10)
  payment_terms   text,
  payment_due_date date,
  tax_exemption_note text,                       -- z. B. Hinweis § 19 UStG oder Reverse Charge
  e_invoice_format text CHECK (e_invoice_format IN ('none','zugferd','xrechnung_cii','xrechnung_ubl')),
  pdf_media_id    uuid,
  xml_media_id    uuid,
  issued_at       timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  created_by      uuid DEFAULT kernel.current_actor_id(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  updated_by      uuid DEFAULT kernel.current_actor_id(),
  version         integer NOT NULL DEFAULT 1,
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, related_invoice_id) REFERENCES invoicing.invoice(tenant_id, id),
  CHECK (status = 'draft' OR (invoice_number IS NOT NULL AND issue_date IS NOT NULL AND issued_at IS NOT NULL))
);
CREATE UNIQUE INDEX invoice_number_idx ON invoicing.invoice (tenant_id, document_type, invoice_number)
  WHERE invoice_number IS NOT NULL;
CREATE INDEX invoice_order_idx ON invoicing.invoice (tenant_id, order_id);
SELECT kernel.setup_tenant_table('invoicing.invoice');

CREATE FUNCTION invoicing.tg_invoice_guard() RETURNS trigger
  LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status = 'issued' THEN
    RAISE EXCEPTION 'Ausgestellte Rechnung % ist unveränderlich (GoBD)', OLD.invoice_number
      USING ERRCODE = 'P0001';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END $$;
CREATE TRIGGER aa_invoice_guard BEFORE UPDATE OR DELETE ON invoicing.invoice
  FOR EACH ROW EXECUTE FUNCTION invoicing.tg_invoice_guard();

CREATE TABLE invoicing.invoice_line (
  tenant_id       uuid NOT NULL REFERENCES platform.tenant(id),
  id              uuid NOT NULL DEFAULT uuidv7(),
  invoice_id      uuid NOT NULL,
  position        integer NOT NULL,
  order_line_id   uuid,
  sku             text,
  description     text NOT NULL,
  quantity        numeric(12,3) NOT NULL,
  unit_code       text NOT NULL DEFAULT 'C62',   -- UN/ECE-Einheit, C62 = Stück
  unit_net_amount bigint NOT NULL,
  net_amount      bigint NOT NULL,
  tax_rate_bp     kernel.rate_bp NOT NULL,
  vat_category_code text NOT NULL CHECK (vat_category_code IN ('S','Z','E','AE','K','G','O','L','M')),
  tax_exemption_reason text,
  tax_amount      bigint NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  UNIQUE (tenant_id, invoice_id, position),
  FOREIGN KEY (tenant_id, invoice_id) REFERENCES invoicing.invoice(tenant_id, id)
);
SELECT kernel.enable_tenant_rls('invoicing.invoice_line');
SELECT kernel.make_append_only('invoicing.invoice_line');

-- =============================================================================
-- 15. Schema payments: anbieterneutrale Zahlungen
-- =============================================================================
CREATE SCHEMA payments;

CREATE TABLE payments.payment_method_config (
  tenant_id       uuid NOT NULL REFERENCES platform.tenant(id),
  id              uuid NOT NULL DEFAULT uuidv7(),
  provider        text NOT NULL,                 -- 'test', später 'stripe', 'paypal', 'manual'
  method_code     text NOT NULL,                 -- z. B. 'test_card', 'prepayment'
  name            text NOT NULL,
  description     text,
  status          text NOT NULL DEFAULT 'active' CHECK (status IN ('active','disabled')),
  position        integer NOT NULL DEFAULT 0,
  settings        jsonb NOT NULL DEFAULT '{}'::jsonb,   -- nur nicht geheime Einstellungen
  secret_ciphertext bytea,                       -- verschlüsselte Zugangsdaten (Welle 2)
  allowed_countries kernel.country_code[],       -- NULL = alle (ZAH-09, Welle 4)
  allowed_customer_group_ids uuid[],
  created_at      timestamptz NOT NULL DEFAULT now(),
  created_by      uuid DEFAULT kernel.current_actor_id(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  updated_by      uuid DEFAULT kernel.current_actor_id(),
  version         integer NOT NULL DEFAULT 1,
  PRIMARY KEY (tenant_id, id),
  UNIQUE (tenant_id, provider, method_code)
);
SELECT kernel.setup_tenant_table('payments.payment_method_config');

CREATE TABLE payments.payment (
  tenant_id       uuid NOT NULL REFERENCES platform.tenant(id),
  id              uuid NOT NULL DEFAULT uuidv7(),
  order_id        uuid NOT NULL,
  payment_method_config_id uuid NOT NULL,
  provider        text NOT NULL,
  provider_reference text,
  currency        kernel.currency_code NOT NULL,
  amount          bigint NOT NULL CHECK (amount > 0),
  captured_amount bigint NOT NULL DEFAULT 0 CHECK (captured_amount >= 0),
  refunded_amount bigint NOT NULL DEFAULT 0 CHECK (refunded_amount >= 0),
  status          text NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending','authorized','captured','partially_refunded','refunded','failed','cancelled','expired')),
  created_at      timestamptz NOT NULL DEFAULT now(),
  created_by      uuid DEFAULT kernel.current_actor_id(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  updated_by      uuid DEFAULT kernel.current_actor_id(),
  version         integer NOT NULL DEFAULT 1,
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, payment_method_config_id) REFERENCES payments.payment_method_config(tenant_id, id),
  CHECK (captured_amount <= amount AND refunded_amount <= captured_amount)
);
CREATE INDEX payment_order_idx ON payments.payment (tenant_id, order_id);
CREATE UNIQUE INDEX payment_provider_ref_idx ON payments.payment (tenant_id, provider, provider_reference)
  WHERE provider_reference IS NOT NULL;
SELECT kernel.setup_tenant_table('payments.payment');

CREATE TABLE payments.payment_attempt (
  tenant_id       uuid NOT NULL REFERENCES platform.tenant(id),
  id              uuid NOT NULL DEFAULT uuidv7(),
  payment_id      uuid NOT NULL,
  attempt_no      integer NOT NULL CHECK (attempt_no >= 1),
  provider_session_id text,
  redirect_url    text,
  status          text NOT NULL DEFAULT 'created'
                    CHECK (status IN ('created','redirected','succeeded','failed','cancelled','expired')),
  failure_code    text,
  failure_message text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  created_by      uuid DEFAULT kernel.current_actor_id(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  updated_by      uuid DEFAULT kernel.current_actor_id(),
  version         integer NOT NULL DEFAULT 1,
  completed_at    timestamptz,
  PRIMARY KEY (tenant_id, id),
  UNIQUE (tenant_id, payment_id, attempt_no),
  FOREIGN KEY (tenant_id, payment_id) REFERENCES payments.payment(tenant_id, id)
);
SELECT kernel.setup_tenant_table('payments.payment_attempt');

CREATE TABLE payments.refund (                    -- Welle 1 nur Tabelle, Erstattungen ab Welle 2 (BST-06)
  tenant_id       uuid NOT NULL REFERENCES platform.tenant(id),
  id              uuid NOT NULL DEFAULT uuidv7(),
  payment_id      uuid NOT NULL,
  currency        kernel.currency_code NOT NULL,
  amount          bigint NOT NULL CHECK (amount > 0),
  reason          text CHECK (reason IN ('withdrawal','cancellation','goodwill','duplicate','other')),
  withdrawal_id   uuid,                          -- Verweis auf orders.withdrawal
  provider_reference text,
  status          text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','succeeded','failed')),
  completed_at    timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  created_by      uuid DEFAULT kernel.current_actor_id(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  updated_by      uuid DEFAULT kernel.current_actor_id(),
  version         integer NOT NULL DEFAULT 1,
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, payment_id) REFERENCES payments.payment(tenant_id, id)
);
CREATE INDEX refund_payment_idx ON payments.refund (tenant_id, payment_id);
SELECT kernel.setup_tenant_table('payments.refund');

CREATE TABLE payments.provider_event (
  tenant_id       uuid NOT NULL REFERENCES platform.tenant(id),
  id              uuid NOT NULL DEFAULT uuidv7(),
  provider        text NOT NULL,
  provider_event_id text NOT NULL,
  type            text NOT NULL,
  payload         jsonb NOT NULL,
  signature_valid boolean NOT NULL,
  received_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  UNIQUE (tenant_id, provider, provider_event_id)   -- doppelte Rückmeldungen werden erkannt
);
SELECT kernel.enable_tenant_rls('payments.provider_event');
SELECT kernel.make_append_only('payments.provider_event');

-- =============================================================================
-- 16. Schema shipping: Versandarten, Versandkosten, Sendungen
-- =============================================================================
CREATE SCHEMA shipping;

CREATE TABLE shipping.shipping_method (
  tenant_id       uuid NOT NULL REFERENCES platform.tenant(id),
  id              uuid NOT NULL DEFAULT uuidv7(),
  code            text NOT NULL,
  kind            text NOT NULL DEFAULT 'delivery' CHECK (kind IN ('delivery','pickup','local_delivery')),
  rate_type       text NOT NULL DEFAULT 'flat' CHECK (rate_type IN ('flat','weight','order_value','quantity')),
  status          text NOT NULL DEFAULT 'active' CHECK (status IN ('active','disabled')),
  position        integer NOT NULL DEFAULT 0,
  free_shipping_threshold_amount bigint CHECK (free_shipping_threshold_amount >= 0),
  free_shipping_threshold_currency kernel.currency_code,
  delivery_time_min_days smallint,
  delivery_time_max_days smallint,
  archived_at     timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  created_by      uuid DEFAULT kernel.current_actor_id(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  updated_by      uuid DEFAULT kernel.current_actor_id(),
  version         integer NOT NULL DEFAULT 1,
  PRIMARY KEY (tenant_id, id),
  UNIQUE (tenant_id, code),
  CHECK ((free_shipping_threshold_amount IS NULL) = (free_shipping_threshold_currency IS NULL))
);
SELECT kernel.setup_tenant_table('shipping.shipping_method');

CREATE TABLE shipping.shipping_method_translation (
  tenant_id       uuid NOT NULL REFERENCES platform.tenant(id),
  shipping_method_id uuid NOT NULL,
  locale          kernel.locale_code NOT NULL,
  name            text NOT NULL,
  description     text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  created_by      uuid DEFAULT kernel.current_actor_id(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  updated_by      uuid DEFAULT kernel.current_actor_id(),
  version         integer NOT NULL DEFAULT 1,
  PRIMARY KEY (tenant_id, shipping_method_id, locale),
  FOREIGN KEY (tenant_id, shipping_method_id) REFERENCES shipping.shipping_method(tenant_id, id) ON DELETE CASCADE
);
SELECT kernel.setup_tenant_table('shipping.shipping_method_translation');

CREATE TABLE shipping.shipping_rate (
  tenant_id       uuid NOT NULL REFERENCES platform.tenant(id),
  id              uuid NOT NULL DEFAULT uuidv7(),
  shipping_method_id uuid NOT NULL,
  zone_id         uuid,                          -- Verweis auf shop_settings.zone, NULL = alle Verkaufsländer
  currency        kernel.currency_code NOT NULL,
  amount          bigint NOT NULL CHECK (amount >= 0),
  tax_included    boolean NOT NULL DEFAULT true,
  condition_min   bigint,                        -- je nach rate_type: Gramm, Cent oder Stück
  condition_max   bigint,
  created_at      timestamptz NOT NULL DEFAULT now(),
  created_by      uuid DEFAULT kernel.current_actor_id(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  updated_by      uuid DEFAULT kernel.current_actor_id(),
  version         integer NOT NULL DEFAULT 1,
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, shipping_method_id) REFERENCES shipping.shipping_method(tenant_id, id) ON DELETE CASCADE,
  CHECK (condition_max IS NULL OR condition_min IS NULL OR condition_max > condition_min)
);
CREATE INDEX shipping_rate_method_idx ON shipping.shipping_rate (tenant_id, shipping_method_id, zone_id);
SELECT kernel.setup_tenant_table('shipping.shipping_rate');

CREATE TABLE shipping.shipment (
  tenant_id       uuid NOT NULL REFERENCES platform.tenant(id),
  id              uuid NOT NULL DEFAULT uuidv7(),
  order_id        uuid NOT NULL,
  shipping_method_id uuid,
  location_id     uuid,                          -- Verweis auf inventory.stock_location
  status          text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','shipped','delivered','returned','cancelled')),
  carrier         text,
  tracking_number text,
  tracking_url    text,
  shipped_at      timestamptz,
  delivered_at    timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  created_by      uuid DEFAULT kernel.current_actor_id(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  updated_by      uuid DEFAULT kernel.current_actor_id(),
  version         integer NOT NULL DEFAULT 1,
  PRIMARY KEY (tenant_id, id)
);
CREATE INDEX shipment_order_idx ON shipping.shipment (tenant_id, order_id);
SELECT kernel.setup_tenant_table('shipping.shipment');

CREATE TABLE shipping.shipment_line (
  tenant_id       uuid NOT NULL REFERENCES platform.tenant(id),
  shipment_id     uuid NOT NULL,
  order_line_id   uuid NOT NULL,                 -- Verweis auf orders.order_line
  quantity        integer NOT NULL CHECK (quantity > 0),
  PRIMARY KEY (tenant_id, shipment_id, order_line_id),
  FOREIGN KEY (tenant_id, shipment_id) REFERENCES shipping.shipment(tenant_id, id) ON DELETE CASCADE
);
SELECT kernel.enable_tenant_rls('shipping.shipment_line');

-- =============================================================================
-- 17. Schema content: Inhaltsseiten, Rechtstexte, Menüs, Weiterleitungen
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

-- =============================================================================
-- 18. Schema storefront: Themes, Theme-Einstellungen, Vorlagen (Editor-Grundlage)
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

-- =============================================================================
-- 19. Schema media: Bilder und Dokumente
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

-- =============================================================================
-- 20. Schema notifications: E-Mail-Vorlagen, E-Mail-Protokoll, Meldungen
-- =============================================================================
CREATE SCHEMA notifications;

CREATE TABLE notifications.email_template (       -- vorbereitet, genutzt ab Welle 2 (EIN-05)
  tenant_id       uuid NOT NULL REFERENCES platform.tenant(id),
  id              uuid NOT NULL DEFAULT uuidv7(),
  template_key    text NOT NULL,                 -- 'order_confirmation', 'withdrawal_received', ...
  locale          kernel.locale_code NOT NULL,
  subject         text NOT NULL,
  body            jsonb NOT NULL,                -- Bausteine; Pflichtbausteine bleiben im Code fest
  is_active       boolean NOT NULL DEFAULT true,
  created_at      timestamptz NOT NULL DEFAULT now(),
  created_by      uuid DEFAULT kernel.current_actor_id(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  updated_by      uuid DEFAULT kernel.current_actor_id(),
  version         integer NOT NULL DEFAULT 1,
  PRIMARY KEY (tenant_id, id),
  UNIQUE (tenant_id, template_key, locale)
);
SELECT kernel.setup_tenant_table('notifications.email_template');

CREATE TABLE notifications.email_message (
  tenant_id       uuid NOT NULL REFERENCES platform.tenant(id),
  id              uuid NOT NULL DEFAULT uuidv7(),
  template_key    text NOT NULL,
  template_version integer,                      -- NULL = Standardvorlage aus dem Code
  locale          kernel.locale_code NOT NULL,
  recipient_type  text NOT NULL CHECK (recipient_type IN ('customer','merchant','operator')),
  to_email        text NOT NULL,
  subject         text NOT NULL,
  related_type    text,                          -- z. B. 'order'
  related_id      uuid,
  rendered_storage_key text,                     -- vollständige E-Mail als Datei (Nachweis)
  attachments     jsonb NOT NULL DEFAULT '[]'::jsonb,  -- z. B. Widerrufsformular, AGB-Version
  status          text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','sending','sent','failed','bounced')),
  attempts        integer NOT NULL DEFAULT 0,
  last_error      text,
  provider_message_id text,
  queued_at       timestamptz NOT NULL DEFAULT now(),
  sent_at         timestamptz,
  anonymized_at   timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  created_by      uuid DEFAULT kernel.current_actor_id(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  updated_by      uuid DEFAULT kernel.current_actor_id(),
  version         integer NOT NULL DEFAULT 1,
  PRIMARY KEY (tenant_id, id)
);
CREATE INDEX email_message_related_idx ON notifications.email_message (tenant_id, related_type, related_id);
CREATE INDEX email_message_pending_idx ON notifications.email_message (tenant_id, queued_at) WHERE status IN ('queued','failed');
SELECT kernel.setup_tenant_table('notifications.email_message');

CREATE TABLE notifications.inbox_notification (
  tenant_id       uuid NOT NULL REFERENCES platform.tenant(id),
  id              uuid NOT NULL DEFAULT uuidv7(),
  recipient_user_id uuid,                        -- NULL = alle Mitglieder des Shops
  kind            text NOT NULL,                 -- 'order_placed', 'withdrawal_received', 'stock_low', ...
  title           text NOT NULL,
  body            text,
  link_path       text,
  related_type    text,
  related_id      uuid,
  read_at         timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id)
);
CREATE INDEX inbox_notification_unread_idx ON notifications.inbox_notification (tenant_id, recipient_user_id, created_at DESC) WHERE read_at IS NULL;
SELECT kernel.enable_tenant_rls('notifications.inbox_notification');

CREATE TABLE notifications.processed_event (
  tenant_id       uuid NOT NULL REFERENCES platform.tenant(id),
  event_id        uuid NOT NULL,
  subscriber      text NOT NULL,
  processed_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, subscriber, event_id)
);
SELECT kernel.enable_tenant_rls('notifications.processed_event');

-- =============================================================================
-- 21. Referenzdaten (globale Tabellen)
-- =============================================================================
INSERT INTO kernel.currency (code, minor_units, symbol, name_de) VALUES
  ('EUR', 2, '€', 'Euro'), ('CHF', 2, 'CHF', 'Schweizer Franken'), ('GBP', 2, '£', 'Pfund Sterling'),
  ('USD', 2, '$', 'US-Dollar'), ('PLN', 2, 'zł', 'Złoty'), ('SEK', 2, 'kr', 'Schwedische Krone'),
  ('DKK', 2, 'kr', 'Dänische Krone'), ('CZK', 2, 'Kč', 'Tschechische Krone'), ('JPY', 0, '¥', 'Yen');

INSERT INTO kernel.country (code, name_de, is_eu, default_currency) VALUES
  ('DE','Deutschland',true,'EUR'), ('AT','Österreich',true,'EUR'), ('BE','Belgien',true,'EUR'),
  ('BG','Bulgarien',true,'EUR'), ('CY','Zypern',true,'EUR'), ('CZ','Tschechien',true,'CZK'),
  ('DK','Dänemark',true,'DKK'), ('EE','Estland',true,'EUR'), ('ES','Spanien',true,'EUR'),
  ('FI','Finnland',true,'EUR'), ('FR','Frankreich',true,'EUR'), ('GR','Griechenland',true,'EUR'),
  ('HR','Kroatien',true,'EUR'), ('HU','Ungarn',true,NULL), ('IE','Irland',true,'EUR'),
  ('IT','Italien',true,'EUR'), ('LT','Litauen',true,'EUR'), ('LU','Luxemburg',true,'EUR'),
  ('LV','Lettland',true,'EUR'), ('MT','Malta',true,'EUR'), ('NL','Niederlande',true,'EUR'),
  ('PL','Polen',true,'PLN'), ('PT','Portugal',true,'EUR'), ('RO','Rumänien',true,NULL),
  ('SE','Schweden',true,'SEK'), ('SI','Slowenien',true,'EUR'), ('SK','Slowakei',true,'EUR'),
  ('CH','Schweiz',false,'CHF'), ('GB','Vereinigtes Königreich',false,'GBP'), ('US','Vereinigte Staaten',false,'USD');
UPDATE kernel.country SET requires_region = true WHERE code = 'US';

INSERT INTO tax.tax_class (code, name_de, description, position) VALUES
  ('standard', 'Normalsatz', 'Regelsteuersatz', 1),
  ('reduced',  'Ermäßigter Satz', 'z. B. Lebensmittel, Bücher', 2),
  ('zero',     'Nullsatz', 'z. B. bestimmte Photovoltaikanlagen (§ 12 Abs. 3 UStG)', 3),
  ('exempt',   'Steuerfrei', 'steuerbefreite Umsätze', 4);

-- Deutsche Sätze inklusive der befristeten Senkung 2020, damit alte Bestellungen nachvollziehbar bleiben.
-- Disclaimer: Referenzdaten nach bestem Wissen, vor echter Nutzung zu prüfen.
INSERT INTO tax.tax_rate (country_code, tax_class_code, rate_bp, vat_category_code, valid_from, valid_to, legal_reference) VALUES
  ('DE','standard',1900,'S','2007-01-01','2020-06-30','§ 12 Abs. 1 UStG'),
  ('DE','standard',1600,'S','2020-07-01','2020-12-31','§ 28 Abs. 1 UStG (befristet)'),
  ('DE','standard',1900,'S','2021-01-01',NULL,'§ 12 Abs. 1 UStG'),
  ('DE','reduced', 700,'S','1983-07-01','2020-06-30','§ 12 Abs. 2 UStG'),
  ('DE','reduced', 500,'S','2020-07-01','2020-12-31','§ 28 Abs. 2 UStG (befristet)'),
  ('DE','reduced', 700,'S','2021-01-01',NULL,'§ 12 Abs. 2 UStG'),
  ('DE','zero',      0,'Z','2023-01-01',NULL,'§ 12 Abs. 3 UStG'),
  ('DE','exempt',    0,'E','1980-01-01',NULL,'§ 4 UStG');

INSERT INTO storefront.theme (code, name, theme_version, settings_schema) VALUES
  ('standard', 'Standard', '1.0.0', '{"type":"object"}');

INSERT INTO platform.plan (code, name, is_default, limits) VALUES
  ('standard', 'Standard', true, '{}');

-- =============================================================================
-- 22. Rechte (Grants)
-- =============================================================================
RESET ROLE;

REVOKE ALL ON DATABASE :"DBNAME" FROM PUBLIC;
GRANT CONNECT, TEMPORARY ON DATABASE :"DBNAME" TO shop_app, shop_auth, shop_platform, shop_relay, shop_backup;

-- Schemas
GRANT USAGE ON SCHEMA kernel, identity, shop_settings, audit, catalog, pricing, tax, inventory,
  customers, cart, checkout, orders, invoicing, payments, shipping, content, storefront, media,
  notifications, platform TO shop_app;

-- Mandantentabellen: Lesen und Schreiben, RLS begrenzt auf den eigenen Shop
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA shop_settings, audit, catalog, pricing,
  inventory, customers, cart, checkout, orders, invoicing, payments, shipping, content, storefront,
  media, notifications TO shop_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON kernel.idempotency_key, identity.role, identity.role_permission,
  identity.membership, identity.api_token TO shop_app;
GRANT SELECT, INSERT ON kernel.outbox TO shop_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON tax.tenant_tax_setting TO shop_app;

-- Nur anhängen: kein UPDATE und kein DELETE
REVOKE UPDATE, DELETE ON audit.audit_entry, pricing.price_history, inventory.stock_movement,
  orders.order_line, orders.order_tax_line, orders.order_legal_acceptance, orders.order_event,
  customers.consent_event, payments.provider_event, invoicing.invoice_line,
  shop_settings.cookie_consent_log FROM shop_app;
-- Belege werden nie gelöscht
REVOKE DELETE ON orders."order", orders.order_address, orders.withdrawal, invoicing.invoice,
  payments.payment, payments.payment_attempt, payments.refund FROM shop_app;

-- Globale Referenzdaten: nur lesen
REVOKE INSERT, UPDATE, DELETE ON storefront.theme FROM shop_app;
GRANT SELECT ON kernel.currency, kernel.country, tax.tax_class, tax.tax_rate, storefront.theme TO shop_app;
GRANT SELECT ON platform.tenant, platform.tenant_domain, platform.plan, platform.plan_feature,
  platform.tenant_feature_override, platform.platform_setting TO shop_app;

-- Anmeldung: Die globalen Anmeldetabellen gehören allein der Rolle shop_auth (ADR-008).
-- shop_app darf von Nutzern nur unkritische Spalten lesen (Namen im Team, Einladung per E-Mail).
-- Passwort-Hashes, Sitzungen, Einmalcodes, Zwei-Faktor und Passkeys sind für shop_app unsichtbar.
GRANT SELECT (id, email, email_verified, name, image_url, locale, status) ON identity."user" TO shop_app;

-- Funktionen
GRANT EXECUTE ON FUNCTION shop_settings.next_number(text), pricing.lowest_price(uuid, kernel.currency_code, uuid, integer, timestamptz) TO shop_app;

-- Plattform-Verwaltung
GRANT USAGE ON SCHEMA kernel, platform, identity, audit TO shop_platform;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA platform TO shop_platform;
-- Nutzer anlegen, sperren und Passwörter zurücksetzen erledigt die Plattform über das Anmeldemodul (shop_auth).
GRANT SELECT (id, email, email_verified, name, image_url, locale, status, locked_until, created_at)
  ON identity."user" TO shop_platform;
GRANT SELECT, INSERT ON audit.audit_entry, kernel.outbox TO shop_platform;
GRANT SELECT ON kernel.currency, kernel.country TO shop_platform;

-- Anmeldemodul (Better Auth läuft mit einem eigenen Verbindungspool als shop_auth)
GRANT USAGE ON SCHEMA kernel, identity TO shop_auth;
GRANT SELECT, INSERT, UPDATE, DELETE ON identity."user", identity.account, identity.session,
  identity.verification, identity.two_factor, identity.passkey TO shop_auth;

-- Outbox-Weiterleitung
GRANT USAGE ON SCHEMA kernel TO shop_relay;
GRANT SELECT, DELETE ON kernel.outbox TO shop_relay;
GRANT UPDATE (published_at, attempts, last_error) ON kernel.outbox TO shop_relay;

-- Datensicherung
GRANT pg_read_all_data TO shop_backup;
