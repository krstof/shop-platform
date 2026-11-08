-- =============================================================================
-- Modul identity: API-Token und erneute Passworteingabe (E6 Teil 5, Sicherheit 5.2 und 5.3)
-- =============================================================================

-- Form des Tokens: 'shp_at_' + 43 Zeichen Base64url (32 Byte Zufall). Gespeichert werden nur
-- die ersten 4 Zeichen nach dem Präfix zum Wiedererkennen und der SHA-256-Wert des ganzen Tokens.
ALTER TABLE identity.api_token
  ADD CONSTRAINT api_token_prefix_format CHECK (token_prefix ~ '^shp_at_[A-Za-z0-9_-]{4}$'),
  ADD CONSTRAINT api_token_hash_length CHECK (octet_length(token_hash) = 32),
  ADD CONSTRAINT api_token_name_length CHECK (char_length(name) BETWEEN 1 AND 100),
  ADD CONSTRAINT api_token_expiry_after_creation CHECK (expires_at IS NULL OR expires_at > created_at);

-- Nach dem Anlegen lässt sich an einem Token nichts mehr erweitern: Die Anwendung darf nur noch
-- „zuletzt benutzt“ und „widerrufen“ setzen (Spaltenrechte). Gelöscht wird ein Token nie, nur
-- widerrufen; so bleibt im Änderungsprotokoll nachvollziehbar, wofür es da war.
REVOKE UPDATE, DELETE ON identity.api_token FROM shop_app;
GRANT UPDATE (last_used_at, revoked_at) ON identity.api_token TO shop_app;

-- Sitzung: Wann wurde das Passwort zuletzt erneut eingegeben (POST /auth/v1/confirm-password)?
-- Kritische Aktionen verlangen eine Passworteingabe vor höchstens 15 Minuten; die Anmeldung
-- selbst zählt auch (dann gilt created_at).
ALTER TABLE identity.session ADD COLUMN reauthenticated_at timestamptz;
