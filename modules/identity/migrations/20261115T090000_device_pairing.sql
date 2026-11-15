-- =============================================================================
-- Modul identity: Uhr verbinden (15.11.2026, Kristof: App für die Galaxy Watch)
-- =============================================================================
-- Kopplungscode: Im Backoffice erzeugt (8 Ziffern, 10 Minuten gültig, nur einmal), auf der Uhr
-- eingetippt. Dafür bekommt die Uhr ein API-Token nur zum Lesen von Bestellungen.
-- identifier ist '<Shop-ID>:<Konto-ID>' wie bei Einladungen (höchstens ein gültiger Code je Konto und Shop).

ALTER TABLE identity.verification DROP CONSTRAINT verification_purpose_check;
ALTER TABLE identity.verification
  ADD CONSTRAINT verification_purpose_check
  CHECK (purpose IN ('email_verification','password_reset','email_change','invitation','device_pairing'));

ALTER TABLE identity.verification
  ADD CONSTRAINT verification_device_pairing_identifier CHECK (
    purpose <> 'device_pairing'
    OR identifier ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  );

COMMENT ON TABLE identity.verification IS
  'Einmalcodes (nur SHA-256). password_reset: identifier ist die Konto-ID, 30 Minuten gültig, höchstens einer je Konto. '
  'invitation: identifier ist <Shop-ID>:<Konto-ID>, 7 Tage gültig, höchstens einer je Einladung. '
  'device_pairing: identifier ist <Shop-ID>:<Konto-ID>, 10 Minuten gültig, höchstens einer je Konto und Shop.';
