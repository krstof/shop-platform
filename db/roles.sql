-- =============================================================================
-- roles.sql
-- Grundlage, die vor allen Migrationen läuft: Datenbankrollen, Erweiterungen und
-- Rechte auf der Datenbank selbst. Läuft bei jedem Start des Migrationslaufs mit der
-- Verwaltungsrolle (z. B. postgres) und darf deshalb beliebig oft laufen.
--
-- Keine Passwörter in dieser Datei: Die Passwörter der Anmelderollen setzt der Betrieb
-- aus der .env (Sicherheit 5.4). Rollen siehe docs/03_Architektur.md Kapitel 5.6 und ADR-008.
-- Alles Weitere (Schemas, Tabellen, Rechte auf Tabellen) steht in den Migrationen der
-- Module (packages/kernel/migrations, modules/<modul>/migrations) und gehört shop_owner.
-- =============================================================================

DO $$
BEGIN
  -- Besitzt alle Objekte, kann sich nicht anmelden. RLS gilt durch FORCE auch für sie.
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'shop_owner') THEN
    CREATE ROLE shop_owner NOLOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'shop_app') THEN
    CREATE ROLE shop_app LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOINHERIT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'shop_platform') THEN
    CREATE ROLE shop_platform LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOINHERIT;
  END IF;
  -- Anmeldemodul: einzige Rolle mit Zugriff auf Passwort-Hashes, Sitzungen und Einmalcodes
  -- (Sicherheitskonzept 4.2, ADR-008)
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'shop_auth') THEN
    CREATE ROLE shop_auth LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOINHERIT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'shop_relay') THEN
    CREATE ROLE shop_relay LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOINHERIT;
  END IF;
  -- Datensicherung: pg_dump verweigert bei aktivem RLS die Arbeit, deshalb braucht
  -- nur diese Rolle BYPASSRLS. Sie wird nie von der Anwendung benutzt.
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'shop_backup') THEN
    CREATE ROLE shop_backup LOGIN NOSUPERUSER BYPASSRLS NOCREATEDB NOCREATEROLE NOINHERIT;
  END IF;
END $$;

-- Erweiterung für Ausschluss-Regeln (keine überlappenden Steuersatz-Zeiträume)
CREATE EXTENSION IF NOT EXISTS btree_gist;

-- Rechte auf der Datenbank. Der Name der Datenbank steht nicht fest, deshalb dynamisch.
DO $$
BEGIN
  EXECUTE format('REVOKE ALL ON DATABASE %I FROM PUBLIC', current_database());
  EXECUTE format('GRANT CREATE ON DATABASE %I TO shop_owner', current_database());
  EXECUTE format('GRANT CONNECT, TEMPORARY ON DATABASE %I TO shop_app, shop_auth, shop_platform, shop_relay, shop_backup',
                 current_database());
END $$;

-- Datensicherung darf alles lesen, aber nichts ändern.
GRANT pg_read_all_data TO shop_backup;
