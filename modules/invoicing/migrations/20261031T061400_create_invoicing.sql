-- =============================================================================
-- Modul invoicing: Rechnungen und Gutschriften (vorbereitet, genutzt ab Welle 2,
-- E-Rechnung ab Welle 3)
-- Erste Migration: legt das Schema an, wie es in Welle 0 entworfen wurde
-- (docs/04_Datenmodell.md). Läuft als Rolle shop_owner (eingestellt vom Migrationslauf).
-- =============================================================================

CREATE SCHEMA invoicing;

CREATE TABLE invoicing.invoice (
  tenant_id       uuid NOT NULL REFERENCES platform.tenant(id),
  id              uuid NOT NULL DEFAULT uuidv7(),
  document_type   text NOT NULL CHECK (document_type IN ('invoice','credit_note','cancellation','correction')),
  invoice_number  text,                          -- erst beim Ausstellen vergeben (lückenlos)
  status          text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','issued')),
  order_id        uuid NOT NULL,                 -- Verweis auf orders.order
  related_invoice_id uuid,                       -- ursprüngliche Rechnung bei Storno/Gutschrift
  issue_date      date,
  service_date_from date,                        -- Leistungsdatum oder -zeitraum
  service_date_to date,
  currency        kernel.currency_code NOT NULL,
  net_amount      bigint NOT NULL,
  tax_amount      bigint NOT NULL,
  gross_amount    bigint NOT NULL,
  seller          jsonb NOT NULL,                -- Name, Anschrift, USt-IdNr., Steuernummer (Momentaufnahme)
  buyer           jsonb NOT NULL,                -- Name, Anschrift
  buyer_vat_id    text,                          -- USt-IdNr. des Käufers
  buyer_reference text,                          -- Leitweg-ID (BT-10)
  payment_terms   text,
  payment_due_date date,
  tax_exemption_note text,                       -- z. B. Hinweis § 19 UStG oder Reverse Charge
  e_invoice_format text CHECK (e_invoice_format IN ('none','zugferd','xrechnung_cii','xrechnung_ubl')),
  pdf_media_id    uuid,
  xml_media_id    uuid,
  issued_at       timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  created_by      uuid DEFAULT kernel.current_actor_id(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  updated_by      uuid DEFAULT kernel.current_actor_id(),
  version         integer NOT NULL DEFAULT 1,
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, related_invoice_id) REFERENCES invoicing.invoice(tenant_id, id),
  CHECK (status = 'draft' OR (invoice_number IS NOT NULL AND issue_date IS NOT NULL AND issued_at IS NOT NULL))
);
CREATE UNIQUE INDEX invoice_number_idx ON invoicing.invoice (tenant_id, document_type, invoice_number)
  WHERE invoice_number IS NOT NULL;
CREATE INDEX invoice_order_idx ON invoicing.invoice (tenant_id, order_id);
SELECT kernel.setup_tenant_table('invoicing.invoice');

CREATE FUNCTION invoicing.tg_invoice_guard() RETURNS trigger
  LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status = 'issued' THEN
    RAISE EXCEPTION 'Ausgestellte Rechnung % ist unveränderlich (GoBD)', OLD.invoice_number
      USING ERRCODE = 'P0001';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END $$;
CREATE TRIGGER aa_invoice_guard BEFORE UPDATE OR DELETE ON invoicing.invoice
  FOR EACH ROW EXECUTE FUNCTION invoicing.tg_invoice_guard();

CREATE TABLE invoicing.invoice_line (
  tenant_id       uuid NOT NULL REFERENCES platform.tenant(id),
  id              uuid NOT NULL DEFAULT uuidv7(),
  invoice_id      uuid NOT NULL,
  position        integer NOT NULL,
  order_line_id   uuid,
  sku             text,
  description     text NOT NULL,
  quantity        numeric(12,3) NOT NULL,
  unit_code       text NOT NULL DEFAULT 'C62',   -- UN/ECE-Einheit, C62 = Stück
  unit_net_amount bigint NOT NULL,
  net_amount      bigint NOT NULL,
  tax_rate_bp     kernel.rate_bp NOT NULL,
  vat_category_code text NOT NULL CHECK (vat_category_code IN ('S','Z','E','AE','K','G','O','L','M')),
  tax_exemption_reason text,
  tax_amount      bigint NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  UNIQUE (tenant_id, invoice_id, position),
  FOREIGN KEY (tenant_id, invoice_id) REFERENCES invoicing.invoice(tenant_id, id)
);
SELECT kernel.enable_tenant_rls('invoicing.invoice_line');
SELECT kernel.make_append_only('invoicing.invoice_line');

-- Rechte (Grants)
GRANT USAGE ON SCHEMA invoicing TO shop_app;
-- Mandantentabellen: Lesen und Schreiben, RLS begrenzt auf den eigenen Shop
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA invoicing TO shop_app;
REVOKE UPDATE, DELETE ON invoicing.invoice_line FROM shop_app;
-- Belege werden nie gelöscht
REVOKE DELETE ON invoicing.invoice FROM shop_app;
