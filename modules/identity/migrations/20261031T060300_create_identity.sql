-- =============================================================================
-- Modul identity: Anmeldung (global), Mitgliedschaften und Token (je Shop)
-- Erste Migration: legt das Schema an, wie es in Welle 0 entworfen wurde
-- (docs/04_Datenmodell.md). Läuft als Rolle shop_owner (eingestellt vom Migrationslauf).
-- =============================================================================

CREATE SCHEMA identity;

CREATE TABLE identity."user" (
  id              uuid PRIMARY KEY DEFAULT uuidv7(),
  email           text NOT NULL,
  email_verified  boolean NOT NULL DEFAULT false,
  name            text,
  image_url       text,
  locale          kernel.locale_code NOT NULL DEFAULT 'de',
  status          text NOT NULL DEFAULT 'active' CHECK (status IN ('active','locked','disabled')),
  locked_until    timestamptz,
  two_factor_enabled boolean NOT NULL DEFAULT false,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX user_email_idx ON identity."user" (lower(email));

CREATE TABLE identity.account (
  id              uuid PRIMARY KEY DEFAULT uuidv7(),
  user_id         uuid NOT NULL REFERENCES identity."user"(id) ON DELETE CASCADE,
  provider_id     text NOT NULL,                 -- 'credential' = E-Mail und Passwort
  account_id      text NOT NULL,
  password_hash   text,                          -- Argon2id, nie Klartext
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (provider_id, account_id)
);
CREATE INDEX account_user_idx ON identity.account (user_id);

CREATE TABLE identity.session (
  id              uuid PRIMARY KEY DEFAULT uuidv7(),
  user_id         uuid NOT NULL REFERENCES identity."user"(id) ON DELETE CASCADE,
  token_hash      bytea NOT NULL UNIQUE,
  expires_at      timestamptz NOT NULL,
  ip_address      inet,
  user_agent      text,
  impersonated_by uuid,                          -- Support-Zugriff (Welle 5)
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX session_user_idx ON identity.session (user_id);
CREATE INDEX session_expiry_idx ON identity.session (expires_at);

CREATE TABLE identity.verification (
  id              uuid PRIMARY KEY DEFAULT uuidv7(),
  identifier      text NOT NULL,
  value_hash      bytea NOT NULL,
  purpose         text NOT NULL CHECK (purpose IN ('email_verification','password_reset','email_change','invitation')),
  expires_at      timestamptz NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX verification_identifier_idx ON identity.verification (identifier);

CREATE TABLE identity.two_factor (           -- vorbereitet, genutzt ab Welle 2 (SIC-09)
  id              uuid PRIMARY KEY DEFAULT uuidv7(),
  user_id         uuid NOT NULL UNIQUE REFERENCES identity."user"(id) ON DELETE CASCADE,
  secret_encrypted bytea NOT NULL,
  backup_codes_encrypted bytea NOT NULL,
  enabled_at      timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE identity.passkey (              -- vorbereitet, genutzt ab Welle 2 (SIC-09)
  id              uuid PRIMARY KEY DEFAULT uuidv7(),
  user_id         uuid NOT NULL REFERENCES identity."user"(id) ON DELETE CASCADE,
  name            text,
  credential_id   text NOT NULL UNIQUE,
  public_key      bytea NOT NULL,
  sign_count      bigint NOT NULL DEFAULT 0,
  device_type     text,
  backed_up       boolean NOT NULL DEFAULT false,
  transports      text[],
  last_used_at    timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX passkey_user_idx ON identity.passkey (user_id);

-- Eigene Rollen eines Shops (vorbereitet, genutzt ab Welle 5, PLA-09).
-- Systemrollen ('owner', 'staff') stehen im Code.
CREATE TABLE identity.role (
  tenant_id       uuid NOT NULL REFERENCES platform.tenant(id),
  id              uuid NOT NULL DEFAULT uuidv7(),
  key             text NOT NULL,
  name            text NOT NULL,
  description     text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  created_by      uuid DEFAULT kernel.current_actor_id(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  updated_by      uuid DEFAULT kernel.current_actor_id(),
  version         integer NOT NULL DEFAULT 1,
  PRIMARY KEY (tenant_id, id),
  UNIQUE (tenant_id, key)
);
SELECT kernel.setup_tenant_table('identity.role');

CREATE TABLE identity.role_permission (
  tenant_id       uuid NOT NULL REFERENCES platform.tenant(id),
  role_id         uuid NOT NULL,
  permission      text NOT NULL CHECK (permission ~ '^[a-z_]+:(read|write)$'),
  created_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, role_id, permission),
  FOREIGN KEY (tenant_id, role_id) REFERENCES identity.role(tenant_id, id) ON DELETE CASCADE
);
SELECT kernel.enable_tenant_rls('identity.role_permission');

CREATE TABLE identity.membership (
  tenant_id       uuid NOT NULL REFERENCES platform.tenant(id),
  id              uuid NOT NULL DEFAULT uuidv7(),
  user_id         uuid NOT NULL REFERENCES identity."user"(id),
  role_key        text NOT NULL DEFAULT 'owner',   -- Systemrolle oder 'custom'
  role_id         uuid,                            -- nur bei role_key = 'custom'
  status          text NOT NULL DEFAULT 'active' CHECK (status IN ('invited','active','disabled')),
  invited_by      uuid,
  created_at      timestamptz NOT NULL DEFAULT now(),
  created_by      uuid DEFAULT kernel.current_actor_id(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  updated_by      uuid DEFAULT kernel.current_actor_id(),
  version         integer NOT NULL DEFAULT 1,
  PRIMARY KEY (tenant_id, id),
  UNIQUE (tenant_id, user_id),
  FOREIGN KEY (tenant_id, role_id) REFERENCES identity.role(tenant_id, id),
  CHECK ((role_key = 'custom') = (role_id IS NOT NULL))
);
CREATE UNIQUE INDEX membership_one_owner_idx ON identity.membership (tenant_id) WHERE role_key = 'owner';
CREATE INDEX membership_user_idx ON identity.membership (user_id);
ALTER TABLE identity.membership ENABLE ROW LEVEL SECURITY;
ALTER TABLE identity.membership FORCE ROW LEVEL SECURITY;
-- Lesen: eigener Shop ODER eigene Mitgliedschaften (für die Shop-Auswahl nach dem Login)
CREATE POLICY tenant_isolation ON identity.membership
  USING (tenant_id = kernel.current_tenant_id() OR user_id = kernel.current_user_id())
  WITH CHECK (tenant_id = kernel.current_tenant_id());
SELECT kernel.add_touch_trigger('identity.membership');

CREATE TABLE identity.api_token (
  tenant_id       uuid NOT NULL REFERENCES platform.tenant(id),
  id              uuid NOT NULL DEFAULT uuidv7(),
  name            text NOT NULL,
  token_prefix    text NOT NULL,                 -- z. B. 'shp_at_3f9a' zum Wiedererkennen
  token_hash      bytea NOT NULL UNIQUE,         -- SHA-256 des Tokens, nie das Token selbst
  scopes          text[] NOT NULL CHECK (cardinality(scopes) > 0),
  actor_kind      text NOT NULL DEFAULT 'script' CHECK (actor_kind IN ('script','ai','app','integration')),
  issued_for_user_id uuid,
  expires_at      timestamptz,
  last_used_at    timestamptz,
  revoked_at      timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  created_by      uuid DEFAULT kernel.current_actor_id(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  updated_by      uuid DEFAULT kernel.current_actor_id(),
  version         integer NOT NULL DEFAULT 1,
  PRIMARY KEY (tenant_id, id)
);
ALTER TABLE identity.api_token ENABLE ROW LEVEL SECURITY;
ALTER TABLE identity.api_token FORCE ROW LEVEL SECURITY;
-- Lesen: eigener Shop ODER genau das Token, dessen Hash gerade geprüft wird
CREATE POLICY tenant_isolation ON identity.api_token
  USING (tenant_id = kernel.current_tenant_id() OR token_hash = kernel.current_api_token_hash())
  WITH CHECK (tenant_id = kernel.current_tenant_id());
SELECT kernel.add_touch_trigger('identity.api_token');

-- Rechte (Grants)
GRANT USAGE ON SCHEMA identity TO shop_app, shop_platform, shop_auth;
GRANT SELECT, INSERT, UPDATE, DELETE ON identity.role, identity.role_permission,
  identity.membership, identity.api_token TO shop_app;
-- Die globalen Anmeldetabellen gehören allein der Rolle shop_auth (ADR-008).
-- shop_app darf von Nutzern nur unkritische Spalten lesen (Namen im Team, Einladung per E-Mail).
-- Passwort-Hashes, Sitzungen, Einmalcodes, Zwei-Faktor und Passkeys sind für shop_app unsichtbar.
GRANT SELECT (id, email, email_verified, name, image_url, locale, status) ON identity."user" TO shop_app;
-- Nutzer anlegen, sperren und Passwörter zurücksetzen erledigt die Plattform über das Anmeldemodul (shop_auth).
GRANT SELECT (id, email, email_verified, name, image_url, locale, status, locked_until, created_at)
  ON identity."user" TO shop_platform;
-- Anmeldemodul (Better Auth läuft mit einem eigenen Verbindungspool als shop_auth)
GRANT SELECT, INSERT, UPDATE, DELETE ON identity."user", identity.account, identity.session,
  identity.verification, identity.two_factor, identity.passkey TO shop_auth;
