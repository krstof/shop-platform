-- =============================================================================
-- Modul identity: Zwei-Faktor für das Betreiberkonto (E6 Teil 4, Sicherheit 5.2, ADR-011)
-- =============================================================================

-- Geheimnis und Ersatzcodes sind mit dem Hauptschlüssel verschlüsselt (Envelope Encryption,
-- Sicherheit 5.10); die Schlüsselversion steht im verschlüsselten Wert selbst.
-- Der zuletzt benutzte Zeitschritt verhindert, dass ein mitgelesener Code ein zweites Mal gilt.
ALTER TABLE identity.two_factor
  ADD COLUMN last_used_step bigint,
  ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now();
COMMENT ON TABLE identity.two_factor IS
  'Zwei-Faktor (TOTP). enabled_at NULL: Einrichtung begonnen, aber noch nicht mit einem Code bestätigt.';

-- Sitzung: Ist der zweite Faktor bestätigt? Wie viele falsche Codes gab es? Wann war sie zuletzt aktiv?
-- (Das gleitende Ablaufdatum von Better Auth wird nur alle 15 Minuten nachgeschoben und reicht für
-- die Stunde ohne Aktivität beim Betreiberkonto nicht.)
ALTER TABLE identity.session
  ADD COLUMN two_factor_verified_at timestamptz,
  ADD COLUMN two_factor_failures integer NOT NULL DEFAULT 0 CHECK (two_factor_failures >= 0),
  ADD COLUMN last_seen_at timestamptz NOT NULL DEFAULT now();
