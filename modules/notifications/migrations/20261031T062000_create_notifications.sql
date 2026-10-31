-- =============================================================================
-- Modul notifications: E-Mail-Vorlagen, E-Mail-Protokoll, Meldungen
-- Erste Migration: legt das Schema an, wie es in Welle 0 entworfen wurde
-- (docs/04_Datenmodell.md). Läuft als Rolle shop_owner (eingestellt vom Migrationslauf).
-- =============================================================================

CREATE SCHEMA notifications;

CREATE TABLE notifications.email_template (       -- vorbereitet, genutzt ab Welle 2 (EIN-05)
  tenant_id       uuid NOT NULL REFERENCES platform.tenant(id),
  id              uuid NOT NULL DEFAULT uuidv7(),
  template_key    text NOT NULL,                 -- 'order_confirmation', 'withdrawal_received', ...
  locale          kernel.locale_code NOT NULL,
  subject         text NOT NULL,
  body            jsonb NOT NULL,                -- Bausteine; Pflichtbausteine bleiben im Code fest
  is_active       boolean NOT NULL DEFAULT true,
  created_at      timestamptz NOT NULL DEFAULT now(),
  created_by      uuid DEFAULT kernel.current_actor_id(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  updated_by      uuid DEFAULT kernel.current_actor_id(),
  version         integer NOT NULL DEFAULT 1,
  PRIMARY KEY (tenant_id, id),
  UNIQUE (tenant_id, template_key, locale)
);
SELECT kernel.setup_tenant_table('notifications.email_template');

CREATE TABLE notifications.email_message (
  tenant_id       uuid NOT NULL REFERENCES platform.tenant(id),
  id              uuid NOT NULL DEFAULT uuidv7(),
  template_key    text NOT NULL,
  template_version integer,                      -- NULL = Standardvorlage aus dem Code
  locale          kernel.locale_code NOT NULL,
  recipient_type  text NOT NULL CHECK (recipient_type IN ('customer','merchant','operator')),
  to_email        text NOT NULL,
  subject         text NOT NULL,
  related_type    text,                          -- z. B. 'order'
  related_id      uuid,
  rendered_storage_key text,                     -- vollständige E-Mail als Datei (Nachweis)
  attachments     jsonb NOT NULL DEFAULT '[]'::jsonb,  -- z. B. Widerrufsformular, AGB-Version
  status          text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','sending','sent','failed','bounced')),
  attempts        integer NOT NULL DEFAULT 0,
  last_error      text,
  provider_message_id text,
  queued_at       timestamptz NOT NULL DEFAULT now(),
  sent_at         timestamptz,
  anonymized_at   timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  created_by      uuid DEFAULT kernel.current_actor_id(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  updated_by      uuid DEFAULT kernel.current_actor_id(),
  version         integer NOT NULL DEFAULT 1,
  PRIMARY KEY (tenant_id, id)
);
CREATE INDEX email_message_related_idx ON notifications.email_message (tenant_id, related_type, related_id);
CREATE INDEX email_message_pending_idx ON notifications.email_message (tenant_id, queued_at) WHERE status IN ('queued','failed');
SELECT kernel.setup_tenant_table('notifications.email_message');

CREATE TABLE notifications.inbox_notification (
  tenant_id       uuid NOT NULL REFERENCES platform.tenant(id),
  id              uuid NOT NULL DEFAULT uuidv7(),
  recipient_user_id uuid,                        -- NULL = alle Mitglieder des Shops
  kind            text NOT NULL,                 -- 'order_placed', 'withdrawal_received', 'stock_low', ...
  title           text NOT NULL,
  body            text,
  link_path       text,
  related_type    text,
  related_id      uuid,
  read_at         timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id)
);
CREATE INDEX inbox_notification_unread_idx ON notifications.inbox_notification (tenant_id, recipient_user_id, created_at DESC) WHERE read_at IS NULL;
SELECT kernel.enable_tenant_rls('notifications.inbox_notification');

CREATE TABLE notifications.processed_event (
  tenant_id       uuid NOT NULL REFERENCES platform.tenant(id),
  event_id        uuid NOT NULL,
  subscriber      text NOT NULL,
  processed_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, subscriber, event_id)
);
SELECT kernel.enable_tenant_rls('notifications.processed_event');

-- Rechte (Grants)
GRANT USAGE ON SCHEMA notifications TO shop_app;
-- Mandantentabellen: Lesen und Schreiben, RLS begrenzt auf den eigenen Shop
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA notifications TO shop_app;
