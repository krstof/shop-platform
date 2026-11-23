-- =============================================================================
-- Paket P5 (Produktpflege, Kristof 22.11.2026): Neu-Schildchen als Schalter am
-- Produkt und eigene Suchwörter je Produkt.
-- =============================================================================

-- Das Neu-Schildchen im Shop entstand bisher allein aus dem Veröffentlichungsdatum
-- (14 Tage). Der Schalter lässt das weiter zu („auto“), erlaubt aber auch „immer“
-- und „nie“ je Produkt.
ALTER TABLE catalog.product
  ADD COLUMN new_badge text NOT NULL DEFAULT 'auto'
    CHECK (new_badge IN ('auto','always','never'));

-- Suchwörter: Wörter, unter denen das Produkt gefunden werden soll, obwohl sie
-- nicht im Namen oder Text stehen (etwa „Geschenk“ oder ein alter Markenname).
-- Freitext, durch Komma getrennt; die Suche sucht darin wie im Namen.
ALTER TABLE catalog.product_translation
  ADD COLUMN search_keywords text;
