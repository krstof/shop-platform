-- =============================================================================
-- Modul pricing: Gutscheincodes (einfachste Form)
-- Ein Code gibt Prozent oder einen festen Betrag auf den Warenwert, wahlweise erst ab einem
-- Mindestwert. Der Code steht in Großbuchstaben (Eingaben werden vorher umgewandelt).
-- Läuft als Rolle shop_owner (eingestellt vom Migrationslauf).
-- =============================================================================

CREATE TABLE pricing.coupon (
  tenant_id       uuid NOT NULL REFERENCES platform.tenant(id),
  id              uuid NOT NULL DEFAULT uuidv7(),
  code            text NOT NULL CHECK (code ~ '^[A-Z0-9][A-Z0-9-]{1,31}$'),
  kind            text NOT NULL CHECK (kind IN ('percent','amount')),
  value           bigint NOT NULL CHECK (value > 0),           -- Prozent (1 bis 100) oder Cent
  currency        kernel.currency_code NOT NULL DEFAULT 'EUR',
  min_order_amount bigint CHECK (min_order_amount > 0),        -- Cent, NULL = ohne Mindestwert
  active          boolean NOT NULL DEFAULT true,
  created_at      timestamptz NOT NULL DEFAULT now(),
  created_by      uuid DEFAULT kernel.current_actor_id(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  updated_by      uuid DEFAULT kernel.current_actor_id(),
  version         integer NOT NULL DEFAULT 1,
  PRIMARY KEY (tenant_id, id),
  UNIQUE (tenant_id, code),
  CHECK (kind <> 'percent' OR value <= 100)
);
SELECT kernel.setup_tenant_table('pricing.coupon');

GRANT SELECT, INSERT, UPDATE, DELETE ON pricing.coupon TO shop_app;
