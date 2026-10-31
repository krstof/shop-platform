-- =============================================================================
-- Modul checkout: Ablauf vom Warenkorb zur Bestellung
-- Erste Migration: legt das Schema an, wie es in Welle 0 entworfen wurde
-- (docs/04_Datenmodell.md). Läuft als Rolle shop_owner (eingestellt vom Migrationslauf).
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

-- Rechte (Grants)
GRANT USAGE ON SCHEMA checkout TO shop_app;
-- Mandantentabellen: Lesen und Schreiben, RLS begrenzt auf den eigenen Shop
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA checkout TO shop_app;
