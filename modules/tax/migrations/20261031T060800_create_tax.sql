-- =============================================================================
-- Modul tax: Steuerklassen und Steuersätze (global), Einstellungen je Shop
-- Erste Migration: legt das Schema an, wie es in Welle 0 entworfen wurde
-- (docs/04_Datenmodell.md). Läuft als Rolle shop_owner (eingestellt vom Migrationslauf).
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

-- Referenzdaten (globale Tabellen)
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

-- Rechte (Grants)
GRANT USAGE ON SCHEMA tax TO shop_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON tax.tenant_tax_setting TO shop_app;
-- Globale Referenzdaten: nur lesen
GRANT SELECT ON tax.tax_class, tax.tax_rate TO shop_app;
