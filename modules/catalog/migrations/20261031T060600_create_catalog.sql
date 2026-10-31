-- =============================================================================
-- Modul catalog: Produkte, Varianten, Merkmale, Kategorien, Hersteller
-- Erste Migration: legt das Schema an, wie es in Welle 0 entworfen wurde
-- (docs/04_Datenmodell.md). Läuft als Rolle shop_owner (eingestellt vom Migrationslauf).
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

-- Rechte (Grants)
GRANT USAGE ON SCHEMA catalog TO shop_app;
-- Mandantentabellen: Lesen und Schreiben, RLS begrenzt auf den eigenen Shop
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA catalog TO shop_app;
