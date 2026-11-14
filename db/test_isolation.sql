-- =============================================================================
-- test_isolation.sql
-- Prüft die Mandantentrennung. Läuft angemeldet als Anwendungsrolle shop_app
-- (ohne SUPERUSER, ohne BYPASSRLS). Aufruf über packages/testing/src/isolation.db.test.ts (pnpm test:db), das die
-- Datenbank vorbereitet und die Variablen A und B (Shop-IDs) sowie global_schemas und
-- global_tables (aus db/global-tables.yaml, kommagetrennt) übergibt.
-- Jeder Fehler bricht sofort ab (ON_ERROR_STOP), jede bestandene Prüfung meldet "OK".
-- =============================================================================
\set ON_ERROR_STOP on
\set QUIET on
\pset tuples_only on
\pset format unaligned
SET client_min_messages = notice;

-- ---------------------------------------------------------------------------
-- Hilfsfunktionen (nur in der eigenen Sitzung, Schema pg_temp)
-- ---------------------------------------------------------------------------
CREATE FUNCTION pg_temp.ok(cond boolean, msg text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF cond IS NOT TRUE THEN RAISE EXCEPTION 'FEHLGESCHLAGEN: %', msg; END IF;
  RAISE NOTICE 'OK   %', msg;
END $$;

-- Alle Tabellen mit eingeschalteter RLS in den Modulschemas
CREATE FUNCTION pg_temp.rls_tables() RETURNS SETOF regclass LANGUAGE sql STABLE AS $$
  SELECT c.oid::regclass FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE c.relkind IN ('r','p') AND c.relrowsecurity
     AND n.nspname NOT IN ('pg_catalog','information_schema','public') AND n.nspname NOT LIKE 'pg\_%'
   ORDER BY c.oid::regclass::text
$$;

-- Testdaten für einen Shop. Füllt JEDE Mandantentabelle mit mindestens einer Zeile.
CREATE FUNCTION pg_temp.seed(t uuid, label text) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE
  v_channel uuid; v_zone uuid; v_group uuid; v_customer uuid; v_company uuid; v_manu uuid;
  v_type uuid; v_attr uuid; v_attr_val uuid; v_product uuid; v_variant uuid; v_cat uuid;
  v_price uuid; v_loc uuid; v_cart uuid; v_cs uuid; v_order uuid; v_line uuid; v_legal uuid;
  v_legal_v uuid; v_wd uuid; v_pmc uuid; v_pay uuid; v_sm uuid; v_ship uuid; v_page uuid;
  v_ti uuid; v_tpl uuid; v_media uuid := uuidv7(); v_user uuid; v_role uuid; v_inv uuid;
  v_order_no text;
BEGIN
  PERFORM set_config('app.tenant_id', t::text, true);

  -- shop_settings
  INSERT INTO shop_settings.shop_profile (tenant_id, shop_name, company_name, vat_id)
    VALUES (t, 'Shop ' || label, label || ' GmbH', 'DE123456789');
  INSERT INTO shop_settings.sales_channel (tenant_id, code, kind, name, is_default)
    VALUES (t, 'storefront', 'storefront', 'Storefront', true) RETURNING id INTO v_channel;
  INSERT INTO shop_settings.sales_country (tenant_id, country_code) VALUES (t, 'DE');
  INSERT INTO shop_settings.zone (tenant_id, code, name) VALUES (t, 'de', 'Deutschland') RETURNING id INTO v_zone;
  INSERT INTO shop_settings.zone_country (tenant_id, zone_id, country_code) VALUES (t, v_zone, 'DE');
  INSERT INTO shop_settings.number_range (tenant_id, kind, prefix, include_year, min_digits) VALUES
    (t, 'order', 'B-', true, 5), (t, 'customer', 'K-', false, 6), (t, 'invoice', 'R-', true, 6),
    (t, 'withdrawal', 'W-', false, 5), (t, 'delivery_note', 'L-', false, 4);
  INSERT INTO shop_settings.cookie_service (tenant_id, key, category, provider, purpose, cookie_names)
    VALUES (t, 'cart', 'necessary', 'Shop', 'Warenkorb merken', ARRAY['cart_token']);
  INSERT INTO shop_settings.cookie_consent_config (tenant_id) VALUES (t);
  INSERT INTO shop_settings.cookie_consent_log (tenant_id, consent_ref, config_revision, choices)
    VALUES (t, uuidv7(), 1, '{"statistics":false}');

  -- tax
  INSERT INTO tax.tenant_tax_setting (tenant_id) VALUES (t);

  -- customers
  INSERT INTO customers.customer_group (tenant_id, code, name, is_default)
    VALUES (t, 'consumers', 'Endkunden', true) RETURNING id INTO v_group;
  INSERT INTO customers.company (tenant_id, name, vat_id, buyer_reference)
    VALUES (t, 'Firma ' || label, 'DE999999999', '991-12345-67') RETURNING id INTO v_company;
  INSERT INTO customers.customer (tenant_id, customer_number, email, first_name, last_name)
    VALUES (t, shop_settings.next_number('customer'), 'kunde@' || label || '.test', 'Erika', 'Muster')
    RETURNING id INTO v_customer;
  INSERT INTO customers.customer_group_member (tenant_id, customer_group_id, customer_id) VALUES (t, v_group, v_customer);
  INSERT INTO customers.company_member (tenant_id, company_id, customer_id) VALUES (t, v_company, v_customer);
  INSERT INTO customers.customer_address (tenant_id, customer_id, address_line1, postal_code, city, country_code)
    VALUES (t, v_customer, 'Teststraße 1', '20095', 'Hamburg', 'DE');
  INSERT INTO customers.consent_event (tenant_id, customer_id, purpose, action, source)
    VALUES (t, v_customer, 'newsletter', 'granted', 'checkout');
  INSERT INTO customers.processed_event (tenant_id, event_id, subscriber) VALUES (t, uuidv7(), 'test');

  -- catalog
  INSERT INTO catalog.manufacturer (tenant_id, name, country_code, eu_responsible_name)
    VALUES (t, 'Teehaus ' || label, 'DE', 'Max Verantwortlich') RETURNING id INTO v_manu;
  INSERT INTO catalog.product_type (tenant_id, code, name) VALUES (t, 'tea', 'Tee') RETURNING id INTO v_type;
  INSERT INTO catalog.attribute (tenant_id, code, input_type) VALUES (t, 'size', 'select') RETURNING id INTO v_attr;
  INSERT INTO catalog.attribute_translation (tenant_id, attribute_id, locale, name) VALUES (t, v_attr, 'de', 'Größe');
  INSERT INTO catalog.attribute_value (tenant_id, attribute_id, code) VALUES (t, v_attr, '100g') RETURNING id INTO v_attr_val;
  INSERT INTO catalog.attribute_value_translation (tenant_id, attribute_value_id, locale, label) VALUES (t, v_attr_val, 'de', '100 g');
  INSERT INTO catalog.product_type_attribute (tenant_id, product_type_id, attribute_id, usage) VALUES (t, v_type, v_attr, 'variant_axis');
  INSERT INTO catalog.product (tenant_id, status, product_type_id, manufacturer_id, tax_class_code,
                               delivery_time_min_days, delivery_time_max_days)
    VALUES (t, 'published', v_type, v_manu, 'reduced', 2, 4) RETURNING id INTO v_product;
  INSERT INTO catalog.variant (tenant_id, product_id, is_default, sku, unit_content_quantity, unit_content_unit,
                               unit_base_quantity, unit_base_unit)
    VALUES (t, v_product, true, 'TEE-' || label, 100, 'g', 1, 'kg') RETURNING id INTO v_variant;
  INSERT INTO catalog.product_translation (tenant_id, product_id, locale, name, slug, key_features)
    VALUES (t, v_product, 'de', 'Grüner Tee ' || label, 'gruener-tee', '100 g Sencha aus Japan');
  INSERT INTO catalog.product_attribute_value (tenant_id, product_id, attribute_id, attribute_value_id) VALUES (t, v_product, v_attr, v_attr_val);
  INSERT INTO catalog.variant_translation (tenant_id, variant_id, locale, title) VALUES (t, v_variant, 'de', '100 g');
  INSERT INTO catalog.variant_attribute_value (tenant_id, variant_id, attribute_id, attribute_value_id) VALUES (t, v_variant, v_attr, v_attr_val);
  INSERT INTO catalog.category (tenant_id) VALUES (t) RETURNING id INTO v_cat;
  INSERT INTO catalog.category_translation (tenant_id, category_id, locale, name, slug) VALUES (t, v_cat, 'de', 'Tee', 'tee');
  INSERT INTO catalog.product_category (tenant_id, category_id, product_id, is_primary) VALUES (t, v_cat, v_product, true);
  INSERT INTO catalog.product_channel_listing (tenant_id, product_id, channel_id) VALUES (t, v_product, v_channel);

  -- media
  INSERT INTO media.media_asset (tenant_id, id, kind, storage_key, mime_type, status)
    VALUES (t, v_media, 'image', 'tenants/' || t || '/media/' || v_media || '/original', 'image/jpeg', 'ready');
  INSERT INTO media.media_asset_translation (tenant_id, media_asset_id, locale, alt_text) VALUES (t, v_media, 'de', 'Teepackung');
  INSERT INTO media.media_rendition (tenant_id, media_asset_id, preset, format, storage_key)
    VALUES (t, v_media, 'w640', 'webp', 'tenants/' || t || '/media/' || v_media || '/w640.webp');
  INSERT INTO media.media_usage (tenant_id, media_asset_id, owner_module, owner_type, owner_id) VALUES (t, v_media, 'catalog', 'product', v_product);
  INSERT INTO catalog.product_media (tenant_id, product_id, media_asset_id) VALUES (t, v_product, v_media);

  -- pricing (Preisverlauf entsteht automatisch per Trigger)
  INSERT INTO pricing.price (tenant_id, variant_id, currency, amount) VALUES (t, v_variant, 'EUR', 1299) RETURNING id INTO v_price;

  -- inventory
  INSERT INTO inventory.stock_location (tenant_id, code, name, is_default) VALUES (t, 'main', 'Hauptlager', true) RETURNING id INTO v_loc;
  INSERT INTO inventory.stock_level (tenant_id, variant_id, location_id, on_hand) VALUES (t, v_variant, v_loc, 10);
  INSERT INTO inventory.stock_movement (tenant_id, variant_id, location_id, quantity_delta, reason) VALUES (t, v_variant, v_loc, 10, 'initial');
  INSERT INTO inventory.processed_event (tenant_id, event_id, subscriber) VALUES (t, uuidv7(), 'test');

  -- cart und checkout
  INSERT INTO cart.cart (tenant_id, token_hash, channel_id) VALUES (t, sha256(convert_to(label || '-cart', 'UTF8')), v_channel) RETURNING id INTO v_cart;
  INSERT INTO cart.cart_line (tenant_id, cart_id, variant_id, line_key, quantity, added_unit_amount)
    VALUES (t, v_cart, v_variant, v_variant::text, 1, 1299);
  INSERT INTO checkout.checkout_session (tenant_id, cart_id, channel_id, email) VALUES (t, v_cart, v_channel, 'kunde@' || label || '.test') RETURNING id INTO v_cs;

  -- payments und shipping (Konfiguration)
  INSERT INTO payments.payment_method_config (tenant_id, provider, method_code, name) VALUES (t, 'test', 'test_card', 'Testzahlung') RETURNING id INTO v_pmc;
  INSERT INTO shipping.shipping_method (tenant_id, code) VALUES (t, 'flat') RETURNING id INTO v_sm;
  INSERT INTO shipping.shipping_method_translation (tenant_id, shipping_method_id, locale, name) VALUES (t, v_sm, 'de', 'Pauschalversand');
  INSERT INTO shipping.shipping_rate (tenant_id, shipping_method_id, zone_id, currency, amount) VALUES (t, v_sm, v_zone, 'EUR', 495);

  -- content
  INSERT INTO content.legal_document (tenant_id, type) VALUES (t, 'terms') RETURNING id INTO v_legal;
  INSERT INTO content.legal_document_version (tenant_id, legal_document_id, locale, version_number, state, title, slug,
                                              document, content_hash, published_at)
    VALUES (t, v_legal, 'de', 1, 'published', 'AGB', 'agb', '{"schemaVersion":1,"sections":[]}',
            sha256(convert_to('AGB ' || label, 'UTF8')), now()) RETURNING id INTO v_legal_v;
  INSERT INTO content.page (tenant_id, kind, status) VALUES (t, 'home', 'published') RETURNING id INTO v_page;
  INSERT INTO content.page_translation (tenant_id, page_id, locale, title, slug) VALUES (t, v_page, 'de', 'Startseite', 'start');
  INSERT INTO content.page_version (tenant_id, page_id, locale, version_number, state, document, published_at)
    VALUES (t, v_page, 'de', 1, 'published', '{"schemaVersion":1,"sections":[{"id":"s1","type":"hero","settings":{},"blocks":[]}]}', now());
  INSERT INTO content.navigation_menu (tenant_id, key) VALUES (t, 'footer');
  INSERT INTO content.url_redirect (tenant_id, from_path, to_path) VALUES (t, '/alter-tee', '/gruener-tee');

  -- storefront
  INSERT INTO storefront.theme_installation (tenant_id, theme_code, is_active) VALUES (t, 'standard', true) RETURNING id INTO v_ti;
  INSERT INTO storefront.template (tenant_id, theme_installation_id, kind) VALUES (t, v_ti, 'home') RETURNING id INTO v_tpl;
  INSERT INTO storefront.template_version (tenant_id, template_id, version_number, document)
    VALUES (t, v_tpl, 1, '{"schemaVersion":1,"sections":[]}');

  -- ai: Verbrauch des Assistenten je Tag
  INSERT INTO ai.usage_day (tenant_id, day, requests, input_tokens, output_tokens) VALUES (t, current_date, 1, 100, 20);

  -- orders: Bestellung als Momentaufnahme mit lückenloser Nummer
  v_order_no := shop_settings.next_number('order');
  INSERT INTO orders."order" (tenant_id, order_number, channel_id, checkout_session_id, customer_id, customer_group_id,
                              email, locale, currency, tax_display, subtotal_amount, shipping_amount, tax_amount, total_amount,
                              shipping_method_id, shipping_method_name, payment_method_config_id, payment_method_name, payment_provider)
    VALUES (t, v_order_no, v_channel, v_cs, v_customer, v_group, 'kunde@' || label || '.test', 'de', 'EUR', 'gross',
            1299, 495, 164, 1794, v_sm, 'Pauschalversand', v_pmc, 'Testzahlung', 'test')
    RETURNING id INTO v_order;
  INSERT INTO orders.order_line (tenant_id, order_id, position, product_id, variant_id, sku, product_name, key_features,
                                 quantity, unit_price_amount, unit_price_includes_tax, line_subtotal_amount, tax_class_code,
                                 tax_rate_bp, vat_category_code, tax_amount, line_total_amount, unit_pricing, manufacturer_snapshot)
    VALUES (t, v_order, 1, v_product, v_variant, 'TEE-' || label, 'Grüner Tee', '100 g Sencha', 1, 1299, true, 1299,
            'reduced', 700, 'S', 85, 1299, '{"content":"100 g","base":"1 kg","basePriceAmount":12990}', '{"name":"Teehaus"}')
    RETURNING id INTO v_line;
  INSERT INTO orders.order_address (tenant_id, order_id, kind, first_name, last_name, address_line1, postal_code, city, country_code)
    VALUES (t, v_order, 'billing', 'Erika', 'Muster', 'Teststraße 1', '20095', 'Hamburg', 'DE');
  INSERT INTO orders.order_tax_line (tenant_id, order_id, tax_class_code, rate_bp, vat_category_code, country_code, taxable_amount, tax_amount)
    VALUES (t, v_order, 'reduced', 700, 'S', 'DE', 1214, 85);
  INSERT INTO orders.order_legal_acceptance (tenant_id, order_id, document_type, legal_document_version_id, version_number, content_hash, acceptance)
    VALUES (t, v_order, 'terms', v_legal_v, 1, sha256(convert_to('AGB ' || label, 'UTF8')), 'notice');
  INSERT INTO orders.order_event (tenant_id, order_id, type, actor_type) VALUES (t, v_order, 'placed', 'customer');
  INSERT INTO orders.withdrawal (tenant_id, withdrawal_number, order_id, channel, entered_order_number, entered_email, statement)
    VALUES (t, shop_settings.next_number('withdrawal'), v_order, 'button', v_order_no, 'kunde@' || label || '.test',
            'Hiermit widerrufe ich den Vertrag.') RETURNING id INTO v_wd;
  INSERT INTO orders.withdrawal_line (tenant_id, withdrawal_id, order_line_id, quantity) VALUES (t, v_wd, v_line, 1);
  INSERT INTO orders.processed_event (tenant_id, event_id, subscriber) VALUES (t, uuidv7(), 'test');
  INSERT INTO inventory.reservation (tenant_id, variant_id, location_id, quantity, reference_type, reference_id)
    VALUES (t, v_variant, v_loc, 1, 'order', v_order);
  UPDATE inventory.stock_level SET reserved = reserved + 1 WHERE variant_id = v_variant AND location_id = v_loc;

  -- payments (Vorgänge)
  INSERT INTO payments.payment (tenant_id, order_id, payment_method_config_id, provider, currency, amount, status, captured_amount)
    VALUES (t, v_order, v_pmc, 'test', 'EUR', 1794, 'captured', 1794) RETURNING id INTO v_pay;
  INSERT INTO payments.payment_attempt (tenant_id, payment_id, attempt_no, status) VALUES (t, v_pay, 1, 'succeeded');
  INSERT INTO payments.refund (tenant_id, payment_id, currency, amount, reason, withdrawal_id) VALUES (t, v_pay, 'EUR', 1299, 'withdrawal', v_wd);
  INSERT INTO payments.provider_event (tenant_id, provider, provider_event_id, type, payload, signature_valid)
    VALUES (t, 'test', 'evt_' || label, 'payment.captured', '{}', true);

  -- shipping (Sendung)
  INSERT INTO shipping.shipment (tenant_id, order_id, shipping_method_id, location_id, status) VALUES (t, v_order, v_sm, v_loc, 'shipped') RETURNING id INTO v_ship;
  INSERT INTO shipping.shipment_line (tenant_id, shipment_id, order_line_id, quantity) VALUES (t, v_ship, v_line, 1);

  -- invoicing (vorbereitet): Entwurf anlegen, Positionen, dann ausstellen
  INSERT INTO invoicing.invoice (tenant_id, document_type, order_id, currency, net_amount, tax_amount, gross_amount, seller, buyer)
    VALUES (t, 'invoice', v_order, 'EUR', 1630, 164, 1794, '{"name":"Shop"}', '{"name":"Erika Muster"}') RETURNING id INTO v_inv;
  INSERT INTO invoicing.invoice_line (tenant_id, invoice_id, position, order_line_id, description, quantity, unit_net_amount, net_amount,
                                      tax_rate_bp, vat_category_code, tax_amount)
    VALUES (t, v_inv, 1, v_line, 'Grüner Tee', 1, 1214, 1214, 700, 'S', 85);
  UPDATE invoicing.invoice SET status = 'issued', invoice_number = shop_settings.next_number('invoice'),
                               issue_date = current_date, issued_at = now()
   WHERE id = v_inv;

  -- notifications
  INSERT INTO notifications.email_template (tenant_id, template_key, locale, subject, body)
    VALUES (t, 'order_confirmation', 'de', 'Ihre Bestellung', '{"blocks":[]}');
  INSERT INTO notifications.email_message (tenant_id, template_key, locale, recipient_type, to_email, subject, related_type, related_id)
    VALUES (t, 'order_confirmation', 'de', 'customer', 'kunde@' || label || '.test', 'Ihre Bestellung ' || v_order_no, 'order', v_order);
  INSERT INTO notifications.inbox_notification (tenant_id, kind, title, related_type, related_id)
    VALUES (t, 'order_placed', 'Neue Bestellung ' || v_order_no, 'order', v_order);
  INSERT INTO notifications.processed_event (tenant_id, event_id, subscriber) VALUES (t, uuidv7(), 'test');

  -- identity (Mitgliedschaft, eigene Rolle, API-Token)
  -- Nutzer legt das Anmeldemodul (shop_auth) an, siehe isolation.db.test.ts. shop_app findet ihn nur per E-Mail.
  SELECT id INTO STRICT v_user FROM identity."user" WHERE email = label || '@haendler.test';
  INSERT INTO identity.membership (tenant_id, user_id, role_key) VALUES (t, v_user, 'owner');
  INSERT INTO identity.role (tenant_id, key, name) VALUES (t, 'packer', 'Packer') RETURNING id INTO v_role;
  INSERT INTO identity.role_permission (tenant_id, role_id, permission) VALUES (t, v_role, 'orders:read');
  INSERT INTO identity.api_token (tenant_id, name, token_prefix, token_hash, scopes)
    VALUES (t, 'Skript', rpad('shp_at_' || label, 11, label), sha256(convert_to('shp_at_secret_' || label, 'UTF8')), ARRAY['products:read']);

  -- audit, kernel
  INSERT INTO audit.audit_entry (tenant_id, actor_type, actor_id, action, entity_type, entity_id)
    VALUES (t, 'user', v_user, 'catalog.product.created', 'product', v_product);
  INSERT INTO audit.processed_event (tenant_id, event_id, subscriber) VALUES (t, uuidv7(), 'test');
  INSERT INTO kernel.outbox (tenant_id, type, actor, correlation_id, data)
    VALUES (t, 'orders.order.placed.v1', '{"type":"customer"}', uuidv7(), jsonb_build_object('orderId', v_order));
  INSERT INTO kernel.idempotency_key (tenant_id, scope, key, request_hash)
    VALUES (t, 'store:placeOrder', 'key-' || label || '-0001', sha256(convert_to('req', 'UTF8')));

  RETURN jsonb_build_object('product', v_product, 'variant', v_variant, 'order', v_order, 'order_number', v_order_no,
                            'user', v_user, 'legal_version', v_legal_v, 'invoice', v_inv);
END $$;

-- ---------------------------------------------------------------------------
-- 1. Rolle und Struktur
-- ---------------------------------------------------------------------------
\echo '--- 1. Rolle und Struktur'
SELECT pg_temp.ok(current_user = 'shop_app', 'Test läuft angemeldet als shop_app');
SELECT pg_temp.ok(NOT rolsuper AND NOT rolbypassrls, 'shop_app hat weder SUPERUSER noch BYPASSRLS')
  FROM pg_roles WHERE rolname = current_user;
SELECT pg_temp.ok(NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname IN ('shop_app','shop_auth','shop_platform','shop_relay','shop_owner')
                                                       AND (rolsuper OR rolbypassrls)),
                  'Keine Betriebsrolle (app, auth, platform, relay, owner) hat SUPERUSER oder BYPASSRLS');

-- Listen globaler Schemas und Tabellen aus db/global-tables.yaml (Variablen global_schemas, global_tables)
CREATE TEMP TABLE global_schema AS SELECT unnest(string_to_array(:'global_schemas', ',')) AS name;
CREATE TEMP TABLE global_table AS SELECT unnest(string_to_array(:'global_tables', ',')) AS name;
SELECT pg_temp.ok((SELECT count(*) FROM global_schema) >= 1 AND (SELECT count(*) FROM global_table) >= 1,
                  'Liste globaler Tabellen aus db/global-tables.yaml geladen ('
                  || (SELECT count(*) FROM global_schema) || ' Schemas, ' || (SELECT count(*) FROM global_table) || ' Tabellen)');

-- Keine veralteten Einträge: Jedes Schema und jede Tabelle der Liste gibt es, und keine dieser Tabellen hat tenant_id
SELECT pg_temp.ok(count(*) = 0, 'Jedes Schema aus db/global-tables.yaml existiert (fehlend: '
                  || coalesce(string_agg(name, ', '), 'keine') || ')')
FROM global_schema WHERE NOT EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = name);
SELECT pg_temp.ok(count(*) = 0, 'Jede Tabelle aus db/global-tables.yaml existiert und hat keine tenant_id (Abweichungen: '
                  || coalesce(string_agg(name, ', '), 'keine') || ')')
FROM global_table g
WHERE to_regclass(g.name) IS NULL
   OR EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = to_regclass(g.name) AND a.attname = 'tenant_id' AND NOT a.attisdropped);

-- Jede Tabelle mit tenant_id außerhalb der globalen Schemas hat RLS, FORCE und eine Policy
SELECT pg_temp.ok(count(*) = 0, 'Jede Tabelle mit tenant_id hat RLS ENABLE + FORCE + Policy (Verstöße: '
                  || coalesce(string_agg(t, ', '), 'keine') || ')')
FROM (
  SELECT c.oid::regclass::text AS t
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE c.relkind = 'r' AND n.nspname NOT IN ('pg_catalog','information_schema','public')
     AND n.nspname NOT IN (SELECT name FROM global_schema)
     AND n.nspname NOT LIKE 'pg\_%'
     AND EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = c.oid AND a.attname = 'tenant_id' AND NOT a.attisdropped)
     AND (NOT c.relrowsecurity OR NOT c.relforcerowsecurity
          OR NOT EXISTS (SELECT 1 FROM pg_policy p WHERE p.polrelid = c.oid))
) v;

-- Tabellen ohne tenant_id müssen auf der Liste der globalen Tabellen stehen
SELECT pg_temp.ok(count(*) = 0, 'Tabellen ohne tenant_id stehen alle auf der Liste globaler Tabellen (unerwartet: '
                  || coalesce(string_agg(t, ', '), 'keine') || ')')
FROM (
  SELECT c.oid::regclass::text AS t
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE c.relkind = 'r' AND n.nspname NOT IN ('pg_catalog','information_schema','public')
     AND n.nspname NOT IN (SELECT name FROM global_schema)
     AND n.nspname NOT LIKE 'pg\_%'
     AND NOT EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = c.oid AND a.attname = 'tenant_id' AND NOT a.attisdropped)
     AND c.oid NOT IN (SELECT to_regclass(name) FROM global_table WHERE to_regclass(name) IS NOT NULL)
) v;

-- Buchführung des Migrationslaufs ist für die Anwendung unerreichbar
SELECT pg_temp.ok(NOT has_schema_privilege('shop_migration', 'USAGE'),
                  'shop_app hat keinen Zugriff auf die Buchführung der Migrationen (shop_migration)');

-- Kein Fremdschlüssel über Modulgrenzen, außer auf platform.tenant
SELECT pg_temp.ok(count(*) = 0, 'Keine Fremdschlüssel über Modulgrenzen außer auf platform.tenant (Verstöße: '
                  || coalesce(string_agg(conname, ', '), 'keine') || ')')
FROM pg_constraint k
JOIN pg_class src ON src.oid = k.conrelid JOIN pg_namespace sn ON sn.oid = src.relnamespace
JOIN pg_class dst ON dst.oid = k.confrelid JOIN pg_namespace dn ON dn.oid = dst.relnamespace
WHERE k.contype = 'f' AND sn.nspname <> dn.nspname AND dst.oid <> 'platform.tenant'::regclass;

-- Jeder Index auf einer RLS-Tabelle beginnt mit tenant_id (Ausnahmen: global eindeutige Hashes, Outbox-Relay)
SELECT pg_temp.ok(count(*) = 0, 'Jeder Index auf RLS-Tabellen beginnt mit tenant_id (Ausnahmen: '
                  || coalesce(string_agg(idx, ', '), 'keine') || ')')
FROM (
  SELECT i.indexrelid::regclass::text AS idx
    FROM pg_index i JOIN pg_class c ON c.oid = i.indrelid
    JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum = i.indkey[0]
   WHERE c.oid IN (SELECT pg_temp.rls_tables()) AND a.attname <> 'tenant_id'
     AND i.indexrelid::regclass::text NOT IN (
       'audit.audit_entry_pkey', 'kernel.outbox_pkey', 'kernel.outbox_unpublished_idx',
       'identity.api_token_token_hash_key', 'identity.membership_user_idx')
) v;

-- ---------------------------------------------------------------------------
-- 2. Testdaten für Shop A und Shop B anlegen (jeweils als shop_app im eigenen Shop)
-- ---------------------------------------------------------------------------
\echo '--- 2. Testdaten'
SELECT pg_temp.seed(:'A', 'a') AS seed_a \gset
SELECT pg_temp.seed(:'B', 'b') AS seed_b \gset
SELECT (:'seed_b'::jsonb) ->> 'product' AS b_product, (:'seed_b'::jsonb) ->> 'order' AS b_order,
       (:'seed_a'::jsonb) ->> 'order' AS a_order, (:'seed_a'::jsonb) ->> 'variant' AS a_variant,
       (:'seed_a'::jsonb) ->> 'legal_version' AS a_legal_version, (:'seed_a'::jsonb) ->> 'invoice' AS a_invoice,
       (:'seed_b'::jsonb) ->> 'user' AS b_user \gset
-- Werte auch für DO-Blöcke verfügbar machen (Sitzungs-Einstellungen test.*)
SELECT set_config('test.b_product', :'b_product', false), set_config('test.a_order', :'a_order', false),
       set_config('test.a_variant', :'a_variant', false), set_config('test.a_legal_version', :'a_legal_version', false),
       set_config('test.a_invoice', :'a_invoice', false) \g /dev/null
SELECT pg_temp.ok(true, 'Testdaten für Shop A und Shop B angelegt');

-- Zeilenzahlen von Shop B merken, um später zu beweisen, dass A nichts verändert hat
CREATE TEMP TABLE b_counts (tbl text PRIMARY KEY, n bigint);
DO $$
DECLARE t regclass; n bigint;
BEGIN
  PERFORM set_config('app.tenant_id', current_setting('test.b'), true);
  FOR t IN SELECT pg_temp.rls_tables() LOOP
    IF has_table_privilege(t, 'SELECT') THEN
      EXECUTE format('SELECT count(*) FROM %s', t) INTO n;
      INSERT INTO b_counts VALUES (t::text, n);
    END IF;
  END LOOP;
END $$;

-- ---------------------------------------------------------------------------
-- 3. Ohne gesetzten Mandanten ist nichts sichtbar
-- ---------------------------------------------------------------------------
\echo '--- 3. Ohne Mandant'
DO $$
DECLARE t regclass; n bigint; total int := 0;
BEGIN
  FOR t IN SELECT pg_temp.rls_tables() LOOP
    IF has_table_privilege(t, 'SELECT') THEN
      EXECUTE format('SELECT count(*) FROM %s', t) INTO n;
      IF n <> 0 THEN RAISE EXCEPTION 'FEHLGESCHLAGEN: % liefert ohne Mandant % Zeilen', t, n; END IF;
      total := total + 1;
    END IF;
  END LOOP;
  RAISE NOTICE 'OK   Ohne app.tenant_id liefern alle % RLS-Tabellen 0 Zeilen', total;
END $$;

BEGIN;
SELECT set_config('app.tenant_id', '', true) \gset
SELECT pg_temp.ok((SELECT count(*) FROM catalog.product) = 0 AND (SELECT count(*) FROM orders."order") = 0,
                  'Mit leerem app.tenant_id liefern Produkte und Bestellungen 0 Zeilen');
COMMIT;

DO $$
BEGIN
  PERFORM set_config('app.tenant_id', 'kein-uuid', true);
  PERFORM count(*) FROM catalog.product;
  RAISE EXCEPTION 'FEHLGESCHLAGEN: ungültiger Mandant wurde akzeptiert';
EXCEPTION WHEN invalid_text_representation THEN
  RAISE NOTICE 'OK   Ein ungültiger Wert in app.tenant_id führt zu einem Fehler statt zu Daten';
END $$;

DO $$
BEGIN
  INSERT INTO catalog.manufacturer (tenant_id, name) VALUES (current_setting('test.a')::uuid, 'Ohne Kontext');
  RAISE EXCEPTION 'FEHLGESCHLAGEN: Schreiben ohne Mandant war möglich';
EXCEPTION WHEN insufficient_privilege THEN
  RAISE NOTICE 'OK   Schreiben ohne gesetzten Mandanten wird abgewiesen';
END $$;

-- ---------------------------------------------------------------------------
-- 4. Als Shop A: nur eigene Zeilen lesbar, jede RLS-Tabelle hat Testdaten
-- ---------------------------------------------------------------------------
\echo '--- 4. Lesen als Shop A'
DO $$
DECLARE t regclass; foreign_rows bigint; own_rows bigint; total int := 0; empty text[] := '{}';
BEGIN
  PERFORM set_config('app.tenant_id', current_setting('test.a'), true);
  FOR t IN SELECT pg_temp.rls_tables() LOOP
    IF has_table_privilege(t, 'SELECT') THEN
      EXECUTE format('SELECT count(*) FILTER (WHERE tenant_id IS DISTINCT FROM %L::uuid), count(*) FROM %s',
                     current_setting('test.a'), t) INTO foreign_rows, own_rows;
      IF foreign_rows <> 0 THEN
        RAISE EXCEPTION 'FEHLGESCHLAGEN: % zeigt Shop A % fremde Zeilen', t, foreign_rows;
      END IF;
      IF own_rows = 0 THEN empty := empty || t::text; END IF;
      total := total + 1;
    END IF;
  END LOOP;
  IF cardinality(empty) > 0 THEN
    RAISE EXCEPTION 'FEHLGESCHLAGEN: Testdaten fehlen in %', empty;
  END IF;
  RAISE NOTICE 'OK   Alle % RLS-Tabellen enthalten Daten von Shop A und keine einzige fremde Zeile', total;
END $$;

BEGIN;
SELECT set_config('app.tenant_id', :'A', true) \gset
SELECT pg_temp.ok((SELECT count(*) FROM catalog.product WHERE id = :'b_product') = 0,
                  'Shop A findet das Produkt von Shop B auch über dessen genaue ID nicht');
SELECT pg_temp.ok((SELECT count(*) FROM orders."order" WHERE id = :'b_order') = 0,
                  'Shop A findet die Bestellung von Shop B auch über deren genaue ID nicht');
SELECT pg_temp.ok((SELECT count(*) FROM audit.audit_entry WHERE tenant_id IS NULL) = 0,
                  'Plattform-Einträge im Audit-Log (ohne Mandant) sind für Shops unsichtbar');
SELECT pg_temp.ok((SELECT count(*) FROM identity.membership WHERE user_id = :'b_user') = 0,
                  'Shop A sieht die Mitgliedschaft des Inhabers von Shop B nicht');
COMMIT;

-- ---------------------------------------------------------------------------
-- 5. Als Shop A: Zeilen von Shop B weder ändern noch löschen noch anlegen
-- ---------------------------------------------------------------------------
\echo '--- 5. Schreiben als Shop A'
DO $$
DECLARE t regclass; n bigint; upd int := 0; del int := 0;
BEGIN
  PERFORM set_config('app.tenant_id', current_setting('test.a'), true);
  FOR t IN SELECT pg_temp.rls_tables() LOOP
    IF has_table_privilege(t, 'UPDATE') THEN
      EXECUTE format('UPDATE %s SET tenant_id = tenant_id WHERE tenant_id = %L::uuid', t, current_setting('test.b'));
      GET DIAGNOSTICS n = ROW_COUNT;
      IF n <> 0 THEN RAISE EXCEPTION 'FEHLGESCHLAGEN: Shop A konnte % Zeilen von Shop B in % ändern', n, t; END IF;
      upd := upd + 1;
    END IF;
    IF has_table_privilege(t, 'DELETE') THEN
      EXECUTE format('DELETE FROM %s WHERE tenant_id = %L::uuid', t, current_setting('test.b'));
      GET DIAGNOSTICS n = ROW_COUNT;
      IF n <> 0 THEN RAISE EXCEPTION 'FEHLGESCHLAGEN: Shop A konnte % Zeilen von Shop B in % löschen', n, t; END IF;
      del := del + 1;
    END IF;
  END LOOP;
  RAISE NOTICE 'OK   UPDATE auf Zeilen von Shop B trifft in allen % änderbaren Tabellen 0 Zeilen', upd;
  RAISE NOTICE 'OK   DELETE auf Zeilen von Shop B trifft in allen % löschbaren Tabellen 0 Zeilen', del;
END $$;

DO $$
BEGIN
  PERFORM set_config('app.tenant_id', current_setting('test.a'), true);
  INSERT INTO catalog.manufacturer (tenant_id, name) VALUES (current_setting('test.b')::uuid, 'Eingeschleust');
  RAISE EXCEPTION 'FEHLGESCHLAGEN: Shop A konnte eine Zeile für Shop B anlegen';
EXCEPTION WHEN insufficient_privilege THEN
  RAISE NOTICE 'OK   Shop A kann keine Zeile mit der tenant_id von Shop B anlegen (RLS WITH CHECK)';
END $$;

DO $$
BEGIN
  PERFORM set_config('app.tenant_id', current_setting('test.a'), true);
  UPDATE catalog.manufacturer SET tenant_id = current_setting('test.b')::uuid;
  RAISE EXCEPTION 'FEHLGESCHLAGEN: Shop A konnte eigene Zeilen zu Shop B verschieben';
EXCEPTION WHEN insufficient_privilege THEN
  RAISE NOTICE 'OK   Shop A kann eigene Zeilen nicht in Shop B verschieben';
END $$;

DO $$
BEGIN
  PERFORM set_config('app.tenant_id', current_setting('test.a'), true);
  INSERT INTO catalog.variant (tenant_id, product_id, sku) VALUES (current_setting('test.a')::uuid, current_setting('test.b_product')::uuid, 'X');
  RAISE EXCEPTION 'FEHLGESCHLAGEN: Variante von A konnte auf Produkt von B zeigen';
EXCEPTION WHEN foreign_key_violation THEN
  RAISE NOTICE 'OK   Zusammengesetzter Fremdschlüssel verhindert Verweis von Shop A auf ein Produkt von Shop B';
END $$;

-- Shop B ist unverändert
DO $$
DECLARE r record; n bigint;
BEGIN
  PERFORM set_config('app.tenant_id', current_setting('test.b'), true);
  FOR r IN SELECT * FROM b_counts LOOP
    EXECUTE format('SELECT count(*) FROM %s', r.tbl) INTO n;
    IF n <> r.n THEN RAISE EXCEPTION 'FEHLGESCHLAGEN: % hatte bei Shop B % Zeilen, jetzt %', r.tbl, r.n, n; END IF;
  END LOOP;
  RAISE NOTICE 'OK   Alle Daten von Shop B sind nach den Angriffen unverändert';
END $$;

-- ---------------------------------------------------------------------------
-- 6. Anmeldung per API-Token: Suche nur über den Hash, ohne Mandant
-- ---------------------------------------------------------------------------
\echo '--- 6. API-Token'
BEGIN;
SELECT set_config('app.api_token_hash', encode(sha256(convert_to('shp_at_secret_a', 'UTF8')), 'hex'), true) \gset
SELECT pg_temp.ok((SELECT count(*) FROM identity.api_token) = 1
                  AND (SELECT tenant_id FROM identity.api_token) = :'A'::uuid,
                  'Mit dem Hash des Tokens von Shop A ist genau dieses eine Token sichtbar');
COMMIT;
BEGIN;
SELECT set_config('app.api_token_hash', encode(sha256(convert_to('falsch', 'UTF8')), 'hex'), true) \gset
SELECT pg_temp.ok((SELECT count(*) FROM identity.api_token) = 0, 'Mit einem falschen Token ist nichts sichtbar');
COMMIT;

-- ---------------------------------------------------------------------------
-- 7. Fachliche Schutzregeln
-- ---------------------------------------------------------------------------
\echo '--- 7. Schutzregeln'
DO $$
BEGIN
  PERFORM set_config('app.tenant_id', current_setting('test.a'), true);
  INSERT INTO catalog.product (tenant_id) VALUES (current_setting('test.a')::uuid);
  SET CONSTRAINTS ALL IMMEDIATE;
  RAISE EXCEPTION 'FEHLGESCHLAGEN: Produkt ohne Standardvariante wurde akzeptiert';
EXCEPTION WHEN check_violation THEN
  RAISE NOTICE 'OK   Ein Produkt ohne Standardvariante wird beim Abschluss der Transaktion abgelehnt';
END $$;

DO $$
BEGIN
  PERFORM set_config('app.tenant_id', current_setting('test.a'), true);
  UPDATE orders."order" SET total_amount = 1, subtotal_amount = 1 - 495, tax_amount = 0 WHERE id = current_setting('test.a_order')::uuid;
  RAISE EXCEPTION 'FEHLGESCHLAGEN: Betrag einer Bestellung konnte geändert werden';
EXCEPTION WHEN raise_exception THEN
  RAISE NOTICE 'OK   Beträge einer Bestellung sind unveränderlich';
END $$;

DO $$
DECLARE v_before int; v_after int;
BEGIN
  PERFORM set_config('app.tenant_id', current_setting('test.a'), true);
  SELECT version INTO v_before FROM orders."order" WHERE id = current_setting('test.a_order')::uuid;
  UPDATE orders."order" SET status = 'open', payment_status = 'paid'
   WHERE id = current_setting('test.a_order')::uuid AND version = v_before;
  SELECT version INTO v_after FROM orders."order" WHERE id = current_setting('test.a_order')::uuid;
  PERFORM pg_temp.ok(v_after = v_before + 1, 'Status einer Bestellung ist änderbar, die Version steigt um 1 (ETag)');
  UPDATE orders."order" SET status = 'in_progress'
   WHERE id = current_setting('test.a_order')::uuid AND version = v_before;
  PERFORM pg_temp.ok(NOT FOUND, 'Änderung mit veralteter Version trifft 0 Zeilen (optimistisches Sperren)');
END $$;

DO $$
BEGIN
  PERFORM set_config('app.tenant_id', current_setting('test.a'), true);
  UPDATE audit.audit_entry SET action = 'gefälscht';
  RAISE EXCEPTION 'FEHLGESCHLAGEN: Audit-Log konnte geändert werden';
EXCEPTION WHEN insufficient_privilege THEN
  RAISE NOTICE 'OK   Das Audit-Log ist für die Anwendung nicht änderbar';
END $$;

DO $$
BEGIN
  PERFORM set_config('app.tenant_id', current_setting('test.a'), true);
  UPDATE invoicing.invoice SET gross_amount = 1 WHERE id = current_setting('test.a_invoice')::uuid;
  RAISE EXCEPTION 'FEHLGESCHLAGEN: ausgestellte Rechnung konnte geändert werden';
EXCEPTION WHEN raise_exception THEN
  RAISE NOTICE 'OK   Eine ausgestellte Rechnung ist unveränderlich';
END $$;

DO $$
BEGIN
  PERFORM set_config('app.tenant_id', current_setting('test.a'), true);
  UPDATE content.legal_document_version SET title = 'Neue AGB' WHERE id = current_setting('test.a_legal_version')::uuid;
  RAISE EXCEPTION 'FEHLGESCHLAGEN: veröffentlichte AGB-Version konnte geändert werden';
EXCEPTION WHEN raise_exception THEN
  RAISE NOTICE 'OK   Eine veröffentlichte Rechtstext-Version ist unveränderlich';
END $$;

DO $$
BEGIN
  PERFORM set_config('app.tenant_id', current_setting('test.a'), true);
  UPDATE inventory.stock_level SET reserved = on_hand + 1 WHERE variant_id = current_setting('test.a_variant')::uuid;
  RAISE EXCEPTION 'FEHLGESCHLAGEN: Überverkauf war möglich';
EXCEPTION WHEN check_violation THEN
  RAISE NOTICE 'OK   Es kann nicht mehr reserviert werden als vorhanden ist';
END $$;

DO $$
DECLARE v_price uuid; v_low bigint;
BEGIN
  PERFORM set_config('app.tenant_id', current_setting('test.a'), true);
  SELECT id INTO v_price FROM pricing.price WHERE variant_id = current_setting('test.a_variant')::uuid;
  UPDATE pricing.price SET amount = 999 WHERE id = v_price;
  UPDATE pricing.price SET amount = 1299 WHERE id = v_price;
  v_low := pricing.lowest_price(current_setting('test.a_variant')::uuid, 'EUR');
  PERFORM pg_temp.ok(v_low = 999 AND (SELECT count(*) FROM pricing.price_history WHERE price_id = v_price) = 3,
                     'Preisverlauf zeichnet jede Änderung auf, 30-Tage-Tiefstpreis = 9,99 EUR');
END $$;

\echo '--- Alle Prüfungen in test_isolation.sql bestanden'
