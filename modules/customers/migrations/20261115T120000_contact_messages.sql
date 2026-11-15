-- =============================================================================
-- Modul customers: Nachrichten aus dem Kontaktformular des Shops (Posteingang im Backoffice)
-- Einfachste Form: Name, E-Mail, Betreff (freiwillig), Text, gelesen ja/nein.
-- Läuft als Rolle shop_owner (eingestellt vom Migrationslauf).
-- =============================================================================

CREATE TABLE customers.contact_message (
  tenant_id       uuid NOT NULL REFERENCES platform.tenant(id),
  id              uuid NOT NULL DEFAULT uuidv7(),
  name            text NOT NULL CHECK (length(name) BETWEEN 1 AND 100),
  email           text NOT NULL CHECK (length(email) BETWEEN 3 AND 254),
  subject         text NOT NULL DEFAULT '' CHECK (length(subject) <= 150),
  message         text NOT NULL CHECK (length(message) BETWEEN 1 AND 5000),
  read_at         timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  created_by      uuid DEFAULT kernel.current_actor_id(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  updated_by      uuid DEFAULT kernel.current_actor_id(),
  version         integer NOT NULL DEFAULT 1,
  PRIMARY KEY (tenant_id, id)
);
CREATE INDEX contact_message_unread_idx ON customers.contact_message (tenant_id) WHERE read_at IS NULL;
SELECT kernel.setup_tenant_table('customers.contact_message');

GRANT SELECT, INSERT, UPDATE, DELETE ON customers.contact_message TO shop_app;
