// Zugriff auf storefront.theme_installation (Shop-Editor Teil 1). Jeder Shop hat genau eine aktive
// Installation des Themes „standard“. Shops von vor dem Editor haben noch keine Zeile; sie entsteht
// beim ersten Speichern. Bis dahin gilt der Standard mit Version 1 (so startet auch eine neue Zeile).
import type { Transaction } from "@shop/kernel";
import type { DB } from "../db.generated.js";
import { DEFAULT_DESIGN, readSettings, type DesignSettings } from "./design.js";

export const THEME_CODE = "standard";

export interface Installation {
  readonly draft: DesignSettings;
  readonly published: DesignSettings;
  readonly publishedAt: Date | null;
  readonly version: number;
}

const FRESH: Installation = {
  draft: DEFAULT_DESIGN,
  published: DEFAULT_DESIGN,
  publishedAt: null,
  version: 1,
};

function selectActive(trx: Transaction<DB>) {
  return trx
    .selectFrom("storefront.theme_installation")
    .select(["settings_draft", "settings_published", "published_at", "version"])
    .where("is_active", "=", true);
}

function toInstallation(row: {
  settings_draft: unknown;
  settings_published: unknown;
  published_at: Date | null;
  version: number;
}): Installation {
  return {
    draft: readSettings(row.settings_draft),
    published: readSettings(row.settings_published),
    publishedAt: row.published_at,
    version: row.version,
  };
}

export async function readInstallation(trx: Transaction<DB>): Promise<Installation> {
  const row = await selectActive(trx).executeTakeFirst();
  return row === undefined ? FRESH : toInstallation(row);
}

/** Sperrt die Zeile bis zum Ende der Transaktion; legt sie beim ersten Mal an. */
export async function lockInstallation(trx: Transaction<DB>, tenantId: string): Promise<Installation> {
  await trx
    .insertInto("storefront.theme_installation")
    .values({ tenant_id: tenantId, theme_code: THEME_CODE, is_active: true })
    .onConflict((oc) => oc.columns(["tenant_id", "theme_code"]).doNothing())
    .execute();
  const row = await selectActive(trx).forUpdate().executeTakeFirstOrThrow();
  return toInstallation(row);
}

export async function writeInstallation(
  trx: Transaction<DB>,
  change: { draft?: DesignSettings; published?: DesignSettings; publishedAt?: Date },
): Promise<Installation> {
  const row = await trx
    .updateTable("storefront.theme_installation")
    .set({
      ...(change.draft === undefined ? {} : { settings_draft: JSON.stringify(change.draft) }),
      ...(change.published === undefined ? {} : { settings_published: JSON.stringify(change.published) }),
      ...(change.publishedAt === undefined ? {} : { published_at: change.publishedAt }),
    })
    .where("is_active", "=", true)
    .returning(["settings_draft", "settings_published", "published_at", "version"])
    .executeTakeFirstOrThrow();
  return toInstallation(row);
}
