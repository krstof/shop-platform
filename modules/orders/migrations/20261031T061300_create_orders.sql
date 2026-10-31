-- =============================================================================
-- Modul orders: unveränderliche Bestellungen, Zeitleiste, Widerruf
-- Erste Migration: legt das Schema an, wie es in Welle 0 entworfen wurde
-- (docs/04_Datenmodell.md). Läuft als Rolle shop_owner (eingestellt vom Migrationslauf).
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

-- Rechte (Grants)
GRANT USAGE ON SCHEMA orders TO shop_app;
-- Mandantentabellen: Lesen und Schreiben, RLS begrenzt auf den eigenen Shop
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA orders TO shop_app;
REVOKE UPDATE, DELETE ON orders.order_line, orders.order_tax_line, orders.order_legal_acceptance,
  orders.order_event FROM shop_app;
-- Belege werden nie gelöscht
REVOKE DELETE ON orders."order", orders.order_address, orders.withdrawal FROM shop_app;
