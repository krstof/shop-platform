-- =============================================================================
-- test_sicherheit.sql
-- Prüft die Rechte der Datenbankrollen nach dem Grundsatz "so wenig wie nötig"
-- (Sicherheitskonzept docs/05_Sicherheit.md, Kapitel 4 und 7, ADR-008).
-- Läuft als Datenbank-Verwalter und fragt die Rechte jeder Rolle ab, ohne sie zu benutzen.
-- Aufruf über db/test_isolation.sh. Jeder Fehler bricht sofort ab.
-- =============================================================================
\set ON_ERROR_STOP on
\set QUIET on
\pset tuples_only on
\pset format unaligned
SET client_min_messages = notice;

CREATE FUNCTION pg_temp.ok(cond boolean, msg text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF cond IS NOT TRUE THEN RAISE EXCEPTION 'FEHLGESCHLAGEN: %', msg; END IF;
  RAISE NOTICE 'OK   %', msg;
END $$;

-- Alle Tabellen und Sichten der Plattform (ohne Systemschemas)
CREATE FUNCTION pg_temp.app_tables() RETURNS SETOF regclass LANGUAGE sql STABLE AS $$
  SELECT c.oid::regclass FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE c.relkind IN ('r','p','v','m')
     AND n.nspname NOT IN ('pg_catalog','information_schema') AND n.nspname NOT LIKE 'pg_%'
$$;

-- Hat die Rolle irgendein Recht auf die Tabelle (ganze Tabelle oder einzelne Spalten)?
CREATE FUNCTION pg_temp.any_priv(r text, t regclass) RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT has_table_privilege(r, t, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
      OR has_any_column_privilege(r, t, 'SELECT,INSERT,UPDATE,REFERENCES')
$$;

\echo '--- 1. Rollen'
SELECT pg_temp.ok(count(*) = 0, 'Keine shop_*-Rolle ist SUPERUSER, darf Rollen oder Datenbanken anlegen (Verstöße: '
                  || coalesce(string_agg(rolname, ', '), 'keine') || ')')
  FROM pg_roles WHERE rolname LIKE 'shop\_%' AND (rolsuper OR rolcreaterole OR rolcreatedb);
SELECT pg_temp.ok(coalesce(string_agg(rolname, ','), '') = 'shop_backup',
                  'Nur shop_backup hat BYPASSRLS (gefunden: ' || coalesce(string_agg(rolname, ', '), 'keine') || ')')
  FROM pg_roles WHERE rolname LIKE 'shop\_%' AND rolbypassrls;
SELECT pg_temp.ok(NOT rolcanlogin, 'Die Besitzer-Rolle shop_owner kann sich nicht anmelden')
  FROM pg_roles WHERE rolname = 'shop_owner';
SELECT pg_temp.ok(count(*) = 0, 'Keine Betriebsrolle ist Mitglied einer anderen Rolle (Verstöße: '
                  || coalesce(string_agg(m.rolname || ' in ' || g.rolname, ', '), 'keine') || ')')
  FROM pg_auth_members am JOIN pg_roles m ON m.oid = am.member JOIN pg_roles g ON g.oid = am.roleid
 WHERE m.rolname IN ('shop_app','shop_auth','shop_platform','shop_relay');

\echo '--- 2. Anmeldedaten nur für das Anmeldemodul (ADR-008)'
SELECT pg_temp.ok(count(*) = 0, 'shop_app und shop_platform haben kein Recht auf Passwörter, Sitzungen, Einmalcodes, '
                  || 'Zwei-Faktor und Passkeys (Verstöße: ' || coalesce(string_agg(r || ' auf ' || t, ', '), 'keine') || ')')
  FROM (VALUES ('shop_app'), ('shop_platform'), ('shop_relay')) AS roles(r),
       (VALUES ('identity.account'), ('identity.session'), ('identity.verification'),
               ('identity.two_factor'), ('identity.passkey')) AS tabs(t)
 WHERE pg_temp.any_priv(r, t::regclass);
SELECT pg_temp.ok(NOT has_table_privilege('shop_app', 'identity."user"', 'INSERT,UPDATE,DELETE,TRUNCATE')
              AND NOT has_any_column_privilege('shop_app', 'identity."user"', 'INSERT,UPDATE')
              AND NOT has_table_privilege('shop_platform', 'identity."user"', 'INSERT,UPDATE,DELETE,TRUNCATE')
              AND NOT has_any_column_privilege('shop_platform', 'identity."user"', 'INSERT,UPDATE'),
                  'shop_app und shop_platform können Nutzer nur lesen, nicht anlegen oder ändern');
SELECT pg_temp.ok(has_table_privilege('shop_auth', t::regclass, 'SELECT,INSERT,UPDATE,DELETE'),
                  'shop_auth darf ' || t || ' lesen und schreiben')
  FROM (VALUES ('identity."user"'), ('identity.account'), ('identity.session'), ('identity.verification'),
               ('identity.two_factor'), ('identity.passkey')) AS tabs(t);
SELECT pg_temp.ok(count(*) = 0, 'shop_auth hat außerhalb der 6 Anmeldetabellen keinerlei Tabellenrechte (Verstöße: '
                  || coalesce(string_agg(t::text, ', '), 'keine') || ')')
  FROM pg_temp.app_tables() t
 WHERE pg_temp.any_priv('shop_auth', t)
   AND t::text NOT IN ('identity."user"','identity.account','identity.session','identity.verification',
                       'identity.two_factor','identity.passkey');

\echo '--- 3. Geheime Spalten'
-- Jede Spalte, deren Name auf ein Anmeldegeheimnis hindeutet (Passwort, TOTP-Geheimnis, Ersatzcodes,
-- private Schlüssel), ist für die Anwendung unsichtbar. Ausnahme: payments.payment_method_config.secret_ciphertext
-- ist mit einem Hauptschlüssel verschlüsselt, der nicht in der Datenbank liegt (Envelope Encryption).
-- Hash-Spalten zum Wiederfinden (Warenkorb-Token, API-Token, gekürzte IP) sind erlaubt: Aus einem
-- SHA-256-Hash eines langen Zufallswerts lässt sich der Wert nicht zurückrechnen.
SELECT pg_temp.ok(count(*) = 0, 'shop_app, shop_platform und shop_relay lesen keine Anmeldegeheimnisse (Verstöße: '
                  || coalesce(string_agg(r || ': ' || col, ', '), 'keine') || ')')
  FROM (VALUES ('shop_app'), ('shop_platform'), ('shop_relay')) AS roles(r),
       (SELECT a.attrelid::regclass::text || '.' || a.attname AS col, a.attrelid, a.attname
          FROM pg_attribute a JOIN pg_class c ON c.oid = a.attrelid JOIN pg_namespace n ON n.oid = c.relnamespace
         WHERE c.relkind IN ('r','p') AND a.attnum > 0 AND NOT a.attisdropped
           AND n.nspname NOT IN ('pg_catalog','information_schema') AND n.nspname NOT LIKE 'pg_%'
           AND a.attname ~ '(password|secret|encrypted|private_key|backup_code)') cols
 WHERE has_column_privilege(r, cols.attrelid, cols.attname, 'SELECT')
   AND cols.col NOT IN ('payments.payment_method_config.secret_ciphertext');
SELECT pg_temp.ok(count(*) = 3, 'Die Prüfung oben erkennt die Anmeldegeheimnisse wirklich (' || count(*) || ' Spalten gefunden)')
  FROM pg_attribute a JOIN pg_class c ON c.oid = a.attrelid JOIN pg_namespace n ON n.oid = c.relnamespace
 WHERE n.nspname = 'identity' AND a.attnum > 0 AND a.attname ~ '(password|secret|encrypted|private_key|backup_code)';

\echo '--- 4. Weitere Rollen'
SELECT pg_temp.ok(count(*) = 0, 'shop_relay sieht nur die Outbox (Verstöße: ' || coalesce(string_agg(t::text, ', '), 'keine') || ')')
  FROM pg_temp.app_tables() t WHERE pg_temp.any_priv('shop_relay', t) AND t::text <> 'kernel.outbox';
SELECT pg_temp.ok(count(*) = 0, 'shop_platform hat keinen Zugriff auf Shopdaten wie Produkte, Kunden, Bestellungen (Verstöße: '
                  || coalesce(string_agg(t::text, ', '), 'keine') || ')')
  FROM pg_temp.app_tables() t
 WHERE pg_temp.any_priv('shop_platform', t)
   AND split_part(t::text, '.', 1) NOT IN ('platform', 'kernel', 'identity', 'audit');
SELECT pg_temp.ok(count(*) = 0, 'Niemand darf über PUBLIC (alle Rollen) auf Plattform-Tabellen zugreifen (Verstöße: '
                  || coalesce(string_agg(t::text, ', '), 'keine') || ')')
  FROM pg_temp.app_tables() t WHERE pg_temp.any_priv('public', t);
SELECT pg_temp.ok(count(*) = 0, 'Keine Betriebsrolle darf in irgendeinem Schema Objekte anlegen (Verstöße: '
                  || coalesce(string_agg(r || ' in ' || nspname, ', '), 'keine') || ')')
  FROM (VALUES ('shop_app'), ('shop_auth'), ('shop_platform'), ('shop_relay'), ('shop_backup')) AS roles(r), pg_namespace
 WHERE nspname NOT LIKE 'pg_%' AND nspname <> 'information_schema' AND has_schema_privilege(r, oid, 'CREATE');

\echo '--- 5. Funktionen mit erhöhten Rechten'
-- SECURITY DEFINER = Funktion läuft mit den Rechten ihres Besitzers. Ohne festen search_path
-- könnte ein Angreifer eine gleichnamige eigene Funktion unterschieben.
SELECT pg_temp.ok(count(*) = 0, 'Jede SECURITY-DEFINER-Funktion hat einen festen search_path (Verstöße: '
                  || coalesce(string_agg(p.oid::regprocedure::text, ', '), 'keine') || ')')
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
 WHERE p.prosecdef AND n.nspname NOT LIKE 'pg_%' AND n.nspname <> 'information_schema'
   AND NOT EXISTS (SELECT 1 FROM unnest(coalesce(p.proconfig, '{}')) c WHERE c LIKE 'search_path=%');
SELECT pg_temp.ok(count(*) = 0, 'Keine SECURITY-DEFINER-Funktion ist für alle (PUBLIC) aufrufbar (Verstöße: '
                  || coalesce(string_agg(p.oid::regprocedure::text, ', '), 'keine') || ')')
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
 WHERE p.prosecdef AND n.nspname NOT LIKE 'pg_%' AND n.nspname <> 'information_schema'
   AND has_function_privilege('public', p.oid, 'EXECUTE');

\echo '--- Alle Prüfungen in test_sicherheit.sql bestanden'
