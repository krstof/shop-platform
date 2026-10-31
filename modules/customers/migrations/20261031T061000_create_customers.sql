-- =============================================================================
-- Modul customers: Kunden, Gruppen, Adressen, Firmen (B2B), Einwilligungen
-- Erste Migration: legt das Schema an, wie es in Welle 0 entworfen wurde
-- (docs/04_Datenmodell.md). Läuft als Rolle shop_owner (eingestellt vom Migrationslauf).
-- =============================================================================

CREATE SCHEMA customers;

CREATE TABLE customers.customer_group (
  tenant_id       uuid NOT NULL REFERENCES platform.tenant(id),
  id              uuid NOT NULL DEFAULT uuidv7(),
  code            text NOT NULL,                 -- 'consumers' = Standardgruppe "Endkunden"
  name            text NOT NULL,
  is_default      boolean NOT NULL DEFAULT false,
  tax_display     text NOT NULL DEFAULT 'gross' CHECK (tax_display IN ('gross','net')),
  min_order_amount bigint CHECK (min_order_amount >= 0),     -- Welle 3 (WKC-05)
  min_order_currency kernel.currency_code,
  created_at      timestamptz NOT NULL DEFAULT now(),
  created_by      uuid DEFAULT kernel.current_actor_id(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  updated_by      uuid DEFAULT kernel.current_actor_id(),
  version         integer NOT NULL DEFAULT 1,
  PRIMARY KEY (tenant_id, id),
  UNIQUE (tenant_id, code),
  CHECK ((min_order_amount IS NULL) = (min_order_currency IS NULL))
);
CREATE UNIQUE INDEX customer_group_default_idx ON customers.customer_group (tenant_id) WHERE is_default;
SELECT kernel.setup_tenant_table('customers.customer_group');

CREATE TABLE customers.company (                  -- vorbereitet, genutzt ab Welle 3 (B2B-01)
  tenant_id       uuid NOT NULL REFERENCES platform.tenant(id),
  id              uuid NOT NULL DEFAULT uuidv7(),
  name            text NOT NULL,
  legal_name      text,
  vat_id          text,                          -- USt-IdNr.
  vat_id_verified_at timestamptz,
  vat_id_check_result jsonb,                     -- Antwort der VIES-Prüfung
  tax_number      text,
  buyer_reference text,                          -- Standard-Leitweg-ID für E-Rechnungen
  customer_group_id uuid,
  payment_terms_days smallint CHECK (payment_terms_days >= 0),
  credit_limit_amount bigint CHECK (credit_limit_amount >= 0),
  credit_limit_currency kernel.currency_code,
  status          text NOT NULL DEFAULT 'active' CHECK (status IN ('pending','active','blocked','archived')),
  custom_fields   jsonb NOT NULL DEFAULT '{}'::jsonb,
  archived_at     timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  created_by      uuid DEFAULT kernel.current_actor_id(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  updated_by      uuid DEFAULT kernel.current_actor_id(),
  version         integer NOT NULL DEFAULT 1,
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, customer_group_id) REFERENCES customers.customer_group(tenant_id, id),
  CHECK ((credit_limit_amount IS NULL) = (credit_limit_currency IS NULL))
);
SELECT kernel.setup_tenant_table('customers.company');

CREATE TABLE customers.customer (
  tenant_id       uuid NOT NULL REFERENCES platform.tenant(id),
  id              uuid NOT NULL DEFAULT uuidv7(),
  customer_number text,                          -- aus Nummernkreis 'customer'
  kind            text NOT NULL DEFAULT 'guest' CHECK (kind IN ('guest','registered')),
  account_status  text NOT NULL DEFAULT 'none' CHECK (account_status IN ('none','invited','active','disabled')),
  email           text,
  email_normalized text GENERATED ALWAYS AS (lower(email)) STORED,
  first_name      text,
  last_name       text,
  phone           text,
  preferred_locale kernel.locale_code NOT NULL DEFAULT 'de',
  company_id      uuid,                          -- A-11, in Welle 1 immer leer
  default_billing_address_id  uuid,
  default_shipping_address_id uuid,
  custom_fields   jsonb NOT NULL DEFAULT '{}'::jsonb,
  anonymized_at   timestamptz,
  archived_at     timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  created_by      uuid DEFAULT kernel.current_actor_id(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  updated_by      uuid DEFAULT kernel.current_actor_id(),
  version         integer NOT NULL DEFAULT 1,
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, company_id) REFERENCES customers.company(tenant_id, id),
  CHECK (anonymized_at IS NOT NULL OR email IS NOT NULL)
);
CREATE UNIQUE INDEX customer_email_idx ON customers.customer (tenant_id, email_normalized)
  WHERE anonymized_at IS NULL;
CREATE UNIQUE INDEX customer_number_idx ON customers.customer (tenant_id, customer_number)
  WHERE customer_number IS NOT NULL;
CREATE INDEX customer_company_idx ON customers.customer (tenant_id, company_id);
SELECT kernel.setup_tenant_table('customers.customer');

CREATE TABLE customers.customer_group_member (
  tenant_id       uuid NOT NULL REFERENCES platform.tenant(id),
  customer_group_id uuid NOT NULL,
  customer_id     uuid NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, customer_group_id, customer_id),
  FOREIGN KEY (tenant_id, customer_group_id) REFERENCES customers.customer_group(tenant_id, id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, customer_id) REFERENCES customers.customer(tenant_id, id) ON DELETE CASCADE
);
CREATE INDEX customer_group_member_customer_idx ON customers.customer_group_member (tenant_id, customer_id);
SELECT kernel.enable_tenant_rls('customers.customer_group_member');

CREATE TABLE customers.company_member (            -- vorbereitet, genutzt ab Welle 3
  tenant_id       uuid NOT NULL REFERENCES platform.tenant(id),
  company_id      uuid NOT NULL,
  customer_id     uuid NOT NULL,
  role            text NOT NULL DEFAULT 'buyer' CHECK (role IN ('admin','buyer','approver','viewer')),
  spending_limit_amount bigint CHECK (spending_limit_amount >= 0),
  status          text NOT NULL DEFAULT 'active' CHECK (status IN ('invited','active','disabled')),
  created_at      timestamptz NOT NULL DEFAULT now(),
  created_by      uuid DEFAULT kernel.current_actor_id(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  updated_by      uuid DEFAULT kernel.current_actor_id(),
  version         integer NOT NULL DEFAULT 1,
  PRIMARY KEY (tenant_id, company_id, customer_id),
  FOREIGN KEY (tenant_id, company_id) REFERENCES customers.company(tenant_id, id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, customer_id) REFERENCES customers.customer(tenant_id, id) ON DELETE CASCADE
);
CREATE INDEX company_member_customer_idx ON customers.company_member (tenant_id, customer_id);
SELECT kernel.setup_tenant_table('customers.company_member');

CREATE TABLE customers.customer_address (
  tenant_id       uuid NOT NULL REFERENCES platform.tenant(id),
  id              uuid NOT NULL DEFAULT uuidv7(),
  customer_id     uuid,
  company_id      uuid,                          -- Lieferadressen einer Firma (Welle 3)
  label           text,
  first_name      text,
  last_name       text,
  company_name    text,
  address_line1   text NOT NULL,
  address_line2   text,
  postal_code     text,
  city            text NOT NULL,
  region_code     text,
  country_code    kernel.country_code NOT NULL,
  phone           text,
  extra           jsonb NOT NULL DEFAULT '{}'::jsonb,   -- länderspezifische Felder (A-12)
  created_at      timestamptz NOT NULL DEFAULT now(),
  created_by      uuid DEFAULT kernel.current_actor_id(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  updated_by      uuid DEFAULT kernel.current_actor_id(),
  version         integer NOT NULL DEFAULT 1,
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, customer_id) REFERENCES customers.customer(tenant_id, id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, company_id) REFERENCES customers.company(tenant_id, id) ON DELETE CASCADE,
  CHECK (customer_id IS NOT NULL OR company_id IS NOT NULL)
);
CREATE INDEX customer_address_customer_idx ON customers.customer_address (tenant_id, customer_id);
CREATE INDEX customer_address_company_idx ON customers.customer_address (tenant_id, company_id);
SELECT kernel.setup_tenant_table('customers.customer_address');

CREATE TABLE customers.consent_event (
  tenant_id       uuid NOT NULL REFERENCES platform.tenant(id),
  id              uuid NOT NULL DEFAULT uuidv7(),
  customer_id     uuid,
  email_hash      bytea,                         -- für Gäste ohne Kundendatensatz
  purpose         text NOT NULL CHECK (purpose IN ('newsletter','cart_reminder','review_request','marketing_profiling','terms_acceptance')),
  action          text NOT NULL CHECK (action IN ('granted','confirmed','withdrawn')),
  source          text NOT NULL CHECK (source IN ('checkout','account','double_opt_in','merchant','import')),
  legal_text_version_id uuid,                    -- Verweis auf content.legal_document_version
  wording         text,                          -- angezeigter Einwilligungstext
  ip_hash         bytea,
  occurred_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, customer_id) REFERENCES customers.customer(tenant_id, id),
  CHECK (customer_id IS NOT NULL OR email_hash IS NOT NULL)
);
CREATE INDEX consent_event_customer_idx ON customers.consent_event (tenant_id, customer_id, purpose, occurred_at);
SELECT kernel.enable_tenant_rls('customers.consent_event');
SELECT kernel.make_append_only('customers.consent_event');

CREATE TABLE customers.processed_event (
  tenant_id       uuid NOT NULL REFERENCES platform.tenant(id),
  event_id        uuid NOT NULL,
  subscriber      text NOT NULL,
  processed_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, subscriber, event_id)
);
SELECT kernel.enable_tenant_rls('customers.processed_event');

-- Rechte (Grants)
GRANT USAGE ON SCHEMA customers TO shop_app;
-- Mandantentabellen: Lesen und Schreiben, RLS begrenzt auf den eigenen Shop
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA customers TO shop_app;
REVOKE UPDATE, DELETE ON customers.consent_event FROM shop_app;
