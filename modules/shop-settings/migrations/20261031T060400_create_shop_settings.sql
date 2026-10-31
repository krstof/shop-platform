-- =============================================================================
-- Modul shop-settings: Firmendaten, Kanäle, Länder, Zonen, Nummernkreise, Cookies
-- Erste Migration: legt das Schema an, wie es in Welle 0 entworfen wurde
-- (docs/04_Datenmodell.md). Läuft als Rolle shop_owner (eingestellt vom Migrationslauf).
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

-- Rechte (Grants)
GRANT USAGE ON SCHEMA shop_settings TO shop_app;
-- Mandantentabellen: Lesen und Schreiben, RLS begrenzt auf den eigenen Shop
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA shop_settings TO shop_app;
REVOKE UPDATE, DELETE ON shop_settings.cookie_consent_log FROM shop_app;
GRANT EXECUTE ON FUNCTION shop_settings.next_number(text) TO shop_app;
