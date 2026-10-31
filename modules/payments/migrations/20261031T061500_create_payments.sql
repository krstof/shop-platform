-- =============================================================================
-- Modul payments: anbieterneutrale Zahlungen
-- Erste Migration: legt das Schema an, wie es in Welle 0 entworfen wurde
-- (docs/04_Datenmodell.md). Läuft als Rolle shop_owner (eingestellt vom Migrationslauf).
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

-- Rechte (Grants)
GRANT USAGE ON SCHEMA payments TO shop_app;
-- Mandantentabellen: Lesen und Schreiben, RLS begrenzt auf den eigenen Shop
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA payments TO shop_app;
REVOKE UPDATE, DELETE ON payments.provider_event FROM shop_app;
-- Belege werden nie gelöscht
REVOKE DELETE ON payments.payment, payments.payment_attempt, payments.refund FROM shop_app;
