-- =============================================================================
-- Modul inventory: Lagerorte, Bestand, Reservierungen, Bewegungen
-- Erste Migration: legt das Schema an, wie es in Welle 0 entworfen wurde
-- (docs/04_Datenmodell.md). Läuft als Rolle shop_owner (eingestellt vom Migrationslauf).
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

-- Rechte (Grants)
GRANT USAGE ON SCHEMA inventory TO shop_app;
-- Mandantentabellen: Lesen und Schreiben, RLS begrenzt auf den eigenen Shop
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA inventory TO shop_app;
REVOKE UPDATE, DELETE ON inventory.stock_movement FROM shop_app;
