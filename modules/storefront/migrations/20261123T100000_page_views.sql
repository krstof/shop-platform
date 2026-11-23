-- =============================================================================
-- Modul storefront: Seitenaufrufe des Shops (Paket P3, Analytics-Seite im Backoffice)
--
-- Gezählt wird auf dem Server der Storefront, nicht im Browser: kein JavaScript, kein Cookie,
-- keine IP-Adresse, nichts über einzelne Besucher. Gespeichert ist nur, wie oft eine Seite an
-- einem Tag aufgerufen wurde. Mehr braucht der Händler für die Frage „läuft mein Shop?" nicht,
-- und weniger kann man über Besucher kaum speichern.
--
-- Eine Zeile je Shop, Tag und Seite; der Zähler wächst per UPSERT. Läuft als Rolle shop_owner.
-- =============================================================================

CREATE TABLE storefront.page_view (
  tenant_id       uuid NOT NULL REFERENCES platform.tenant(id),
  day             date NOT NULL,
  path            text NOT NULL CHECK (length(path) BETWEEN 1 AND 200),
  -- Art der Seite, damit die Auswertung „Produkte" und „Kategorien" trennen kann.
  kind            text NOT NULL CHECK (kind IN ('start', 'produkt', 'kategorie', 'seite', 'sonstige')),
  views           bigint NOT NULL DEFAULT 0 CHECK (views >= 0),
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, day, path)
);
CREATE INDEX page_view_day_idx ON storefront.page_view (tenant_id, day);
SELECT kernel.enable_tenant_rls('storefront.page_view');

GRANT SELECT, INSERT, UPDATE ON storefront.page_view TO shop_app;
