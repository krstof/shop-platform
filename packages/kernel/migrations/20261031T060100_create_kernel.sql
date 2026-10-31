-- =============================================================================
-- Modul kernel: gemeinsame Werkzeuge, Referenzdaten, Outbox, Idempotenz
-- Erste Migration: legt das Schema an, wie es in Welle 0 entworfen wurde
-- (docs/04_Datenmodell.md). Läuft als Rolle shop_owner (eingestellt vom Migrationslauf).
-- =============================================================================

CREATE SCHEMA kernel;

-- Wertebereiche (Domains) für immer wiederkehrende Codes
CREATE DOMAIN kernel.currency_code AS char(3) CHECK (VALUE ~ '^[A-Z]{3}$');
CREATE DOMAIN kernel.country_code  AS char(2) CHECK (VALUE ~ '^[A-Z]{2}$');
CREATE DOMAIN kernel.locale_code   AS text    CHECK (VALUE ~ '^[a-z]{2,3}(-[A-Z]{2})?$');
CREATE DOMAIN kernel.rate_bp       AS integer CHECK (VALUE BETWEEN 0 AND 100000);

-- Kontext der laufenden Transaktion. Leerer Wert = NULL = keine Zeilen (geschlossen im Zweifel).
CREATE FUNCTION kernel.current_tenant_id() RETURNS uuid
  LANGUAGE sql STABLE PARALLEL SAFE
  AS $$ SELECT nullif(current_setting('app.tenant_id', true), '')::uuid $$;

CREATE FUNCTION kernel.current_actor_id() RETURNS uuid
  LANGUAGE sql STABLE PARALLEL SAFE
  AS $$ SELECT nullif(current_setting('app.actor_id', true), '')::uuid $$;

CREATE FUNCTION kernel.current_user_id() RETURNS uuid
  LANGUAGE sql STABLE PARALLEL SAFE
  AS $$ SELECT nullif(current_setting('app.user_id', true), '')::uuid $$;

-- Hash (SHA-256, hexadezimal) des API-Tokens, das gerade geprüft wird
CREATE FUNCTION kernel.current_api_token_hash() RETURNS bytea
  LANGUAGE sql STABLE PARALLEL SAFE
  AS $$ SELECT decode(nullif(current_setting('app.api_token_hash', true), ''), 'hex') $$;

-- Trigger: Version hochzählen (ETag), updated_at/updated_by setzen, created_* schützen
CREATE FUNCTION kernel.tg_touch_row() RETURNS trigger
  LANGUAGE plpgsql AS $$
BEGIN
  NEW.version    := OLD.version + 1;
  NEW.updated_at := now();
  NEW.updated_by := kernel.current_actor_id();
  NEW.created_at := OLD.created_at;
  NEW.created_by := OLD.created_by;
  RETURN NEW;
END $$;

-- Trigger: Tabelle darf nur wachsen (Protokolle, Momentaufnahmen)
CREATE FUNCTION kernel.tg_append_only() RETURNS trigger
  LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Tabelle %.% ist nur anhängbar (append-only)', TG_TABLE_SCHEMA, TG_TABLE_NAME
    USING ERRCODE = 'P0001';
END $$;

-- Trigger: veröffentlichte Versionen (state <> 'draft') sind unveränderlich,
-- erlaubt ist nur der Wechsel published -> superseded.
CREATE FUNCTION kernel.tg_published_version_guard() RETURNS trigger
  LANGUAGE plpgsql AS $$
DECLARE
  allowed text[] := ARRAY['state','superseded_at','updated_at','updated_by','version'];
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.state <> 'draft' THEN
      RAISE EXCEPTION 'Veröffentlichte Version darf nicht gelöscht werden' USING ERRCODE = 'P0001';
    END IF;
    RETURN OLD;
  END IF;
  IF OLD.state <> 'draft' THEN
    IF (to_jsonb(NEW) - allowed) IS DISTINCT FROM (to_jsonb(OLD) - allowed)
       OR NOT (OLD.state = NEW.state OR (OLD.state = 'published' AND NEW.state = 'superseded')) THEN
      RAISE EXCEPTION 'Veröffentlichte Version ist unveränderlich' USING ERRCODE = 'P0001';
    END IF;
  END IF;
  RETURN NEW;
END $$;

-- Helfer für Migrationen (nur shop_owner darf sie ausführen)
CREATE FUNCTION kernel.enable_tenant_rls(p_table regclass) RETURNS void
  LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE format('ALTER TABLE %s ENABLE ROW LEVEL SECURITY', p_table);
  EXECUTE format('ALTER TABLE %s FORCE ROW LEVEL SECURITY', p_table);
  EXECUTE format(
    'CREATE POLICY tenant_isolation ON %s
       USING      (tenant_id = kernel.current_tenant_id())
       WITH CHECK (tenant_id = kernel.current_tenant_id())', p_table);
END $$;

CREATE FUNCTION kernel.add_touch_trigger(p_table regclass) RETURNS void
  LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE format('CREATE TRIGGER zz_touch_row BEFORE UPDATE ON %s
                  FOR EACH ROW EXECUTE FUNCTION kernel.tg_touch_row()', p_table);
END $$;

CREATE FUNCTION kernel.make_append_only(p_table regclass) RETURNS void
  LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE format('CREATE TRIGGER aa_append_only BEFORE UPDATE OR DELETE ON %s
                  FOR EACH ROW EXECUTE FUNCTION kernel.tg_append_only()', p_table);
END $$;

-- Standard-Mandantentabelle: RLS + Versionszähler
CREATE FUNCTION kernel.setup_tenant_table(p_table regclass) RETURNS void
  LANGUAGE plpgsql AS $$
BEGIN
  PERFORM kernel.enable_tenant_rls(p_table);
  PERFORM kernel.add_touch_trigger(p_table);
END $$;

REVOKE ALL ON FUNCTION kernel.enable_tenant_rls(regclass), kernel.add_touch_trigger(regclass),
  kernel.make_append_only(regclass), kernel.setup_tenant_table(regclass) FROM PUBLIC;

-- Referenzdaten: Währungen (global)
CREATE TABLE kernel.currency (
  code            kernel.currency_code PRIMARY KEY,
  minor_units     smallint NOT NULL CHECK (minor_units BETWEEN 0 AND 4),
  rounding_mode   text NOT NULL DEFAULT 'half_up' CHECK (rounding_mode IN ('half_up','half_even')),
  cash_rounding_minor smallint NOT NULL DEFAULT 1,
  symbol          text NOT NULL,
  name_de         text NOT NULL
);

-- Referenzdaten: Länder (global)
CREATE TABLE kernel.country (
  code            kernel.country_code PRIMARY KEY,
  name_de         text NOT NULL,
  is_eu           boolean NOT NULL DEFAULT false,
  default_currency kernel.currency_code,
  requires_region boolean NOT NULL DEFAULT false,
  address_format  jsonb NOT NULL DEFAULT '{}'::jsonb
);

-- Outbox (ADR-007): Ereignisse, in derselben Transaktion wie die Datenänderung geschrieben
CREATE TABLE kernel.outbox (
  id              uuid PRIMARY KEY DEFAULT uuidv7(),
  tenant_id       uuid,                          -- NULL nur bei plattformweiten Ereignissen
  type            text NOT NULL CHECK (type ~ '^[a-z_]+\.[a-z_]+\.[a-z_]+\.v[0-9]+$'),
  occurred_at     timestamptz NOT NULL DEFAULT now(),
  actor           jsonb NOT NULL,
  correlation_id  uuid NOT NULL,
  causation_id    uuid,
  data            jsonb NOT NULL,
  published_at    timestamptz,
  attempts        integer NOT NULL DEFAULT 0,
  last_error      text
);
CREATE INDEX outbox_unpublished_idx ON kernel.outbox (occurred_at) WHERE published_at IS NULL;
CREATE INDEX outbox_tenant_idx ON kernel.outbox (tenant_id, occurred_at);
ALTER TABLE kernel.outbox ENABLE ROW LEVEL SECURITY;
ALTER TABLE kernel.outbox FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON kernel.outbox
  USING (tenant_id = kernel.current_tenant_id())
  WITH CHECK (tenant_id = kernel.current_tenant_id());
CREATE POLICY platform_events ON kernel.outbox TO shop_platform
  USING (tenant_id IS NULL) WITH CHECK (tenant_id IS NULL);
CREATE POLICY relay_all ON kernel.outbox TO shop_relay
  USING (true) WITH CHECK (true);

-- Idempotenz-Schlüssel (Architektur 4.5), 24 Stunden gültig
CREATE TABLE kernel.idempotency_key (
  tenant_id       uuid NOT NULL,
  id              uuid NOT NULL DEFAULT uuidv7(),
  scope           text NOT NULL,                 -- z. B. 'store:placeOrder'
  key             text NOT NULL CHECK (length(key) BETWEEN 8 AND 255),
  request_hash    bytea NOT NULL,
  status          text NOT NULL DEFAULT 'in_progress' CHECK (status IN ('in_progress','completed')),
  response_status smallint,
  response_body   jsonb,
  created_at      timestamptz NOT NULL DEFAULT now(),
  expires_at      timestamptz NOT NULL DEFAULT now() + interval '24 hours',
  PRIMARY KEY (tenant_id, id),
  UNIQUE (tenant_id, scope, key)
);
CREATE INDEX idempotency_key_expiry_idx ON kernel.idempotency_key (tenant_id, expires_at);
SELECT kernel.enable_tenant_rls('kernel.idempotency_key');

-- Referenzdaten (globale Tabellen)
INSERT INTO kernel.currency (code, minor_units, symbol, name_de) VALUES
  ('EUR', 2, '€', 'Euro'), ('CHF', 2, 'CHF', 'Schweizer Franken'), ('GBP', 2, '£', 'Pfund Sterling'),
  ('USD', 2, '$', 'US-Dollar'), ('PLN', 2, 'zł', 'Złoty'), ('SEK', 2, 'kr', 'Schwedische Krone'),
  ('DKK', 2, 'kr', 'Dänische Krone'), ('CZK', 2, 'Kč', 'Tschechische Krone'), ('JPY', 0, '¥', 'Yen');

INSERT INTO kernel.country (code, name_de, is_eu, default_currency) VALUES
  ('DE','Deutschland',true,'EUR'), ('AT','Österreich',true,'EUR'), ('BE','Belgien',true,'EUR'),
  ('BG','Bulgarien',true,'EUR'), ('CY','Zypern',true,'EUR'), ('CZ','Tschechien',true,'CZK'),
  ('DK','Dänemark',true,'DKK'), ('EE','Estland',true,'EUR'), ('ES','Spanien',true,'EUR'),
  ('FI','Finnland',true,'EUR'), ('FR','Frankreich',true,'EUR'), ('GR','Griechenland',true,'EUR'),
  ('HR','Kroatien',true,'EUR'), ('HU','Ungarn',true,NULL), ('IE','Irland',true,'EUR'),
  ('IT','Italien',true,'EUR'), ('LT','Litauen',true,'EUR'), ('LU','Luxemburg',true,'EUR'),
  ('LV','Lettland',true,'EUR'), ('MT','Malta',true,'EUR'), ('NL','Niederlande',true,'EUR'),
  ('PL','Polen',true,'PLN'), ('PT','Portugal',true,'EUR'), ('RO','Rumänien',true,NULL),
  ('SE','Schweden',true,'SEK'), ('SI','Slowenien',true,'EUR'), ('SK','Slowakei',true,'EUR'),
  ('CH','Schweiz',false,'CHF'), ('GB','Vereinigtes Königreich',false,'GBP'), ('US','Vereinigte Staaten',false,'USD');
UPDATE kernel.country SET requires_region = true WHERE code = 'US';

-- Rechte (Grants)
GRANT USAGE ON SCHEMA kernel TO shop_app, shop_platform, shop_auth, shop_relay;
GRANT SELECT, INSERT, UPDATE, DELETE ON kernel.idempotency_key TO shop_app;
GRANT SELECT, INSERT ON kernel.outbox TO shop_app, shop_platform;
GRANT SELECT ON kernel.currency, kernel.country TO shop_app, shop_platform;
-- Outbox-Weiterleitung
GRANT SELECT, DELETE ON kernel.outbox TO shop_relay;
GRANT UPDATE (published_at, attempts, last_error) ON kernel.outbox TO shop_relay;
