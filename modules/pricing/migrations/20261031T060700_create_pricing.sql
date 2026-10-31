-- =============================================================================
-- Modul pricing: Preise und Preisverlauf
-- Erste Migration: legt das Schema an, wie es in Welle 0 entworfen wurde
-- (docs/04_Datenmodell.md). Läuft als Rolle shop_owner (eingestellt vom Migrationslauf).
-- =============================================================================

CREATE SCHEMA pricing;

CREATE TABLE pricing.price (
  tenant_id       uuid NOT NULL REFERENCES platform.tenant(id),
  id              uuid NOT NULL DEFAULT uuidv7(),
  variant_id      uuid NOT NULL,                 -- Verweis auf catalog.variant
  kind            text NOT NULL DEFAULT 'base' CHECK (kind IN ('base','sale','msrp')),
  currency        kernel.currency_code NOT NULL,
  amount          bigint NOT NULL CHECK (amount >= 0),
  tax_included    boolean NOT NULL DEFAULT true, -- brutto (true) oder netto (false), A-09
  channel_id      uuid,                          -- NULL = alle Kanäle
  customer_group_id uuid,                        -- NULL = alle Kundengruppen
  country_code    kernel.country_code,           -- NULL = alle Länder
  min_quantity    integer NOT NULL DEFAULT 1 CHECK (min_quantity >= 1),
  valid_from      timestamptz,                   -- NULL = seit jeher
  valid_to        timestamptz,                   -- NULL = unbegrenzt
  created_at      timestamptz NOT NULL DEFAULT now(),
  created_by      uuid DEFAULT kernel.current_actor_id(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  updated_by      uuid DEFAULT kernel.current_actor_id(),
  version         integer NOT NULL DEFAULT 1,
  PRIMARY KEY (tenant_id, id),
  CHECK (valid_to IS NULL OR valid_from IS NULL OR valid_to > valid_from),
  CONSTRAINT price_scope_unique UNIQUE NULLS NOT DISTINCT
    (tenant_id, variant_id, kind, currency, channel_id, customer_group_id, country_code, min_quantity, valid_from)
);
CREATE INDEX price_lookup_idx ON pricing.price (tenant_id, variant_id, currency);
SELECT kernel.setup_tenant_table('pricing.price');

CREATE TABLE pricing.price_history (
  tenant_id       uuid NOT NULL REFERENCES platform.tenant(id),
  id              uuid NOT NULL DEFAULT uuidv7(),
  price_id        uuid NOT NULL,
  variant_id      uuid NOT NULL,
  kind            text NOT NULL,
  currency        kernel.currency_code NOT NULL,
  amount          bigint NOT NULL,
  tax_included    boolean NOT NULL,
  channel_id      uuid,
  customer_group_id uuid,
  country_code    kernel.country_code,
  min_quantity    integer NOT NULL,
  valid_from      timestamptz,
  valid_to        timestamptz,
  change_type     text NOT NULL CHECK (change_type IN ('created','updated','deleted')),
  changed_at      timestamptz NOT NULL DEFAULT now(),
  changed_by      uuid DEFAULT kernel.current_actor_id(),
  PRIMARY KEY (tenant_id, id)
);
CREATE INDEX price_history_variant_idx ON pricing.price_history (tenant_id, variant_id, currency, changed_at);
SELECT kernel.enable_tenant_rls('pricing.price_history');
SELECT kernel.make_append_only('pricing.price_history');

-- Jede Preisänderung landet automatisch im Verlauf (A-03)
CREATE FUNCTION pricing.tg_record_price_history() RETURNS trigger
  LANGUAGE plpgsql AS $$
DECLARE
  r pricing.price;
BEGIN
  r := CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  INSERT INTO pricing.price_history
    (tenant_id, price_id, variant_id, kind, currency, amount, tax_included, channel_id,
     customer_group_id, country_code, min_quantity, valid_from, valid_to, change_type)
  VALUES
    (r.tenant_id, r.id, r.variant_id, r.kind, r.currency, r.amount, r.tax_included, r.channel_id,
     r.customer_group_id, r.country_code, r.min_quantity, r.valid_from, r.valid_to,
     CASE TG_OP WHEN 'INSERT' THEN 'created' WHEN 'UPDATE' THEN 'updated' ELSE 'deleted' END);
  RETURN NULL;
END $$;
CREATE TRIGGER price_history AFTER INSERT OR DELETE OR UPDATE OF
  amount, kind, currency, tax_included, channel_id, customer_group_id, country_code,
  min_quantity, valid_from, valid_to
  ON pricing.price FOR EACH ROW EXECUTE FUNCTION pricing.tg_record_price_history();

-- Niedrigster Preis der letzten p_days Tage für Endkunden ohne Sonderbedingungen (STR-12).
-- Berücksichtigt den Preis, der zu Beginn des Zeitfensters galt, und alle Änderungen danach.
-- Vereinfachte Fassung, Feinheiten (geplante Preise) werden in Welle 2 geprüft.
CREATE FUNCTION pricing.lowest_price(p_variant uuid, p_currency kernel.currency_code,
                                     p_channel uuid DEFAULT NULL, p_days integer DEFAULT 30,
                                     p_at timestamptz DEFAULT now())
  RETURNS bigint LANGUAGE sql STABLE AS $$
  WITH h AS (
    SELECT price_id, amount, change_type, changed_at
      FROM pricing.price_history
     WHERE tenant_id = kernel.current_tenant_id()
       AND variant_id = p_variant AND currency = p_currency
       AND kind IN ('base','sale')
       AND (channel_id IS NULL OR channel_id = p_channel)
       AND customer_group_id IS NULL AND country_code IS NULL AND min_quantity = 1
       AND changed_at <= p_at
  ), at_window_start AS (       -- letzter Stand jeder Preiszeile vor dem Fenster
    SELECT DISTINCT ON (price_id) price_id, amount, change_type
      FROM h WHERE changed_at <= p_at - make_interval(days => p_days)
     ORDER BY price_id, changed_at DESC
  )
  SELECT min(amount) FROM (
    SELECT amount FROM at_window_start WHERE change_type <> 'deleted'
    UNION ALL
    SELECT amount FROM h WHERE changed_at > p_at - make_interval(days => p_days)
                          AND change_type <> 'deleted'
  ) x
$$;

-- Rechte (Grants)
GRANT USAGE ON SCHEMA pricing TO shop_app;
-- Mandantentabellen: Lesen und Schreiben, RLS begrenzt auf den eigenen Shop
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA pricing TO shop_app;
REVOKE UPDATE, DELETE ON pricing.price_history FROM shop_app;
GRANT EXECUTE ON FUNCTION pricing.lowest_price(uuid, kernel.currency_code, uuid, integer, timestamptz) TO shop_app;
