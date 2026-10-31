-- =============================================================================
-- Modul shipping: Versandarten, Versandkosten, Sendungen
-- Erste Migration: legt das Schema an, wie es in Welle 0 entworfen wurde
-- (docs/04_Datenmodell.md). Läuft als Rolle shop_owner (eingestellt vom Migrationslauf).
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

-- Rechte (Grants)
GRANT USAGE ON SCHEMA shipping TO shop_app;
-- Mandantentabellen: Lesen und Schreiben, RLS begrenzt auf den eigenen Shop
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA shipping TO shop_app;
