-- =============================================================================
-- Modul cart: Warenkorb
-- Erste Migration: legt das Schema an, wie es in Welle 0 entworfen wurde
-- (docs/04_Datenmodell.md). Läuft als Rolle shop_owner (eingestellt vom Migrationslauf).
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

-- Rechte (Grants)
GRANT USAGE ON SCHEMA cart TO shop_app;
-- Mandantentabellen: Lesen und Schreiben, RLS begrenzt auf den eigenen Shop
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA cart TO shop_app;
