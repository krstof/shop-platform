-- =============================================================================
-- Rechte auf die Warteschlange pg-boss (Etappe E5, Architektur 5.6)
--
-- Nur der Dienst worker spricht mit pg-boss, und zwar als shop_relay: Das Relay stellt die
-- Ereignisse aus kernel.outbox als Aufgaben ein, und der Worker holt sie ab. Die Aufgaben
-- enthalten Ereignisse aller Shops; shop_app (API) erreicht die Warteschlange deshalb gar nicht.
-- Die Verarbeitung selbst läuft danach als shop_app in einer Transaktion für genau einen Shop.
--
-- Nur Datenrechte, keine Strukturrechte: Warteschlangen werden ohne eigene Tabelle angelegt
-- (partition = false), pg-boss muss zur Laufzeit also nichts anlegen oder ändern.
-- =============================================================================

REVOKE ALL ON SCHEMA pgboss FROM PUBLIC;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA pgboss FROM PUBLIC;
GRANT USAGE ON SCHEMA pgboss TO shop_relay;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA pgboss TO shop_relay;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA pgboss TO shop_relay;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA pgboss TO shop_relay;

-- Aufräumen abgelaufener Idempotenz-Schlüssel (Architektur 4.5) als Hintergrundjob des Workers.
-- Über alle Shops hinweg, aber nur Zeilen, deren Frist vorbei ist (eigene Policy).
GRANT USAGE ON SCHEMA kernel TO shop_relay;
GRANT SELECT (tenant_id, id, expires_at), DELETE ON kernel.idempotency_key TO shop_relay;
CREATE POLICY relay_cleanup ON kernel.idempotency_key FOR ALL TO shop_relay
  USING (expires_at < now());
