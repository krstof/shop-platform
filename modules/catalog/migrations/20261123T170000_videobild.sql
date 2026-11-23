-- =============================================================================
-- Paket P5: Vorschaubild zum Video (Kristof 23.11.2026). Beim Hochladen einer
-- eigenen Videodatei entsteht im Browser ein Standbild; es wird wie ein
-- gewöhnliches Produktbild im Modul media abgelegt, hier steht nur der Verweis.
-- =============================================================================

ALTER TABLE catalog.product
  ADD COLUMN video_poster_media_id uuid;
