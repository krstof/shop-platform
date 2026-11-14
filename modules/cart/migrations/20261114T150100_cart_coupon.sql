-- =============================================================================
-- Modul cart: eingegebener Gutscheincode am Warenkorb. Ob er gilt, prüft der Checkout bei jeder
-- Anzeige neu (Modul pricing); hier steht nur, was die Kundin eingegeben hat.
-- =============================================================================

ALTER TABLE cart.cart ADD COLUMN coupon_code text CHECK (coupon_code ~ '^[A-Z0-9][A-Z0-9-]{1,31}$');
