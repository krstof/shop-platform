-- =============================================================================
-- Modul identity: Einmalcodes für „Passwort vergessen“ (E6 Teil 6, Sicherheit 5.2, ADR-013)
-- =============================================================================

-- Gespeichert wird nur der SHA-256-Wert des Codes (32 Byte). Gesucht wird über ihn, und jeder
-- Wert darf nur einmal vorkommen.
ALTER TABLE identity.verification
  ADD CONSTRAINT verification_hash_length CHECK (octet_length(value_hash) = 32),
  ADD CONSTRAINT verification_expiry_after_creation CHECK (expires_at > created_at);
CREATE UNIQUE INDEX verification_value_hash_idx ON identity.verification (value_hash);

COMMENT ON TABLE identity.verification IS
  'Einmalcodes (nur SHA-256). password_reset: identifier ist die Konto-ID, 30 Minuten gültig, höchstens einer je Konto.';
