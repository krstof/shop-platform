-- =============================================================================
-- Modul identity: Mitarbeiter einladen und entfernen (E6 Teil 7, SIC-03, Sicherheit 5.3, ADR-014)
-- =============================================================================

-- Systemrollen stehen im Code (roles.ts); in der Tabelle sind nur sie und 'custom' (Welle 5) erlaubt.
ALTER TABLE identity.membership
  ADD CONSTRAINT membership_role_key CHECK (role_key IN ('owner','staff','custom'));

-- Einladungscodes: identifier ist '<Shop-ID>:<Konto-ID>' (je Einladung höchstens ein gültiger Code).
-- Andere Zwecke behalten ihre Form; für password_reset ist es die Konto-ID.
ALTER TABLE identity.verification
  ADD CONSTRAINT verification_invitation_identifier CHECK (
    purpose <> 'invitation'
    OR identifier ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  );

COMMENT ON TABLE identity.verification IS
  'Einmalcodes (nur SHA-256). password_reset: identifier ist die Konto-ID, 30 Minuten gültig, höchstens einer je Konto. '
  'invitation: identifier ist <Shop-ID>:<Konto-ID>, 7 Tage gültig, höchstens einer je Einladung.';
