-- =============================================================================
-- Modul platform: Ist dieses Konto ein Betreiberkonto? (E6 Teil 4)
-- Die API arbeitet als shop_app und muss bei jeder Anfrage wissen, ob ein Konto die Platform-API
-- nutzen darf und die strengeren Sitzungsregeln gelten. Dafür reichen drei Spalten, nur lesend.
-- =============================================================================
GRANT SELECT (user_id, role, status) ON platform.platform_user TO shop_app;
