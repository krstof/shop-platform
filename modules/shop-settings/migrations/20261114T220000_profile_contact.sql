-- Einstellungen „Allgemein“ (14.11.2026): Ansprechperson, Fax und Handelsregister als ein Text
-- (etwa „Amtsgericht Berlin, HRB 12345“) für die Adresse des Shops.
ALTER TABLE shop_settings.shop_profile
  ADD COLUMN first_name     text CHECK (char_length(first_name) <= 100),
  ADD COLUMN last_name      text CHECK (char_length(last_name) <= 100),
  ADD COLUMN fax            text CHECK (char_length(fax) <= 40),
  ADD COLUMN trade_register text CHECK (char_length(trade_register) <= 200);
