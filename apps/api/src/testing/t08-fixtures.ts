// Testfabriken für T-08: Für jeden Pfad-Platzhalter der Admin-API legt eine Fabrik einen
// Datensatz in einem Shop an und gibt seine ID zurück. Neue Endpunkte mit neuen Platzhaltern
// brauchen hier einen Eintrag, sonst scheitert der T-08-Test mit einem klaren Hinweis.
import type pg from "pg";

export type Fixture = (db: pg.Client, tenantId: string) => Promise<string>;

export const T08_FIXTURES: Readonly<Record<string, Fixture>> = {
  manufacturerId: async (db, tenantId) => {
    const { rows } = await db.query<{ id: string }>(
      `INSERT INTO catalog.manufacturer (tenant_id, name) VALUES ($1, 'T-08 Hersteller') RETURNING id`,
      [tenantId],
    );
    return rows[0]?.id ?? "";
  },
};
