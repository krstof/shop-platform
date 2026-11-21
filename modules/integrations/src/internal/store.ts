// Kern des Moduls integrations: Lesen, Speichern und Entschlüsseln der Anbindungen.
//
// Liegt unter internal/, damit die Endpunkte (http/admin.ts) und die Prüfungen (internal/checks.ts)
// ihn benutzen können, ohne über die Fassade src/index.ts zu gehen — das wäre ein Kreis.
import { getContext, withTenantTransaction, type Database, type SecretBox } from "@shop/kernel";
import type { DB } from "../db.generated.js";
import { fetchExternal } from "./outbound.js";

/** Eine eingerichtete Anbindung, wie andere Module sie brauchen. */
export interface IntegrationCredentials {
  readonly enabled: boolean;
  /** Offene Einstellungen, etwa die Chat-Nummer bei Telegram. */
  readonly settings: Readonly<Record<string, string>>;
  /** Entschlüsselte Zugangsdaten. Niemals an den Browser geben. */
  readonly secrets: Readonly<Record<string, string>>;
}

export interface IntegrationState extends IntegrationCredentials {
  readonly provider: string;
  readonly checkedAt: Date | null;
  readonly checkOk: boolean | null;
  readonly checkMessage: string | null;
}

export interface IntegrationsDependencies {
  /** Verbindung als Rolle shop_app. */
  readonly database: Database<unknown>;
  /** Verschlüsselung der Zugangsdaten. */
  readonly secretBox: SecretBox;
}

export interface Integrations {
  /** Alle eingerichteten Anbindungen des Shops, auch die ausgeschalteten. */
  list(): Promise<readonly IntegrationState[]>;
  /** Eine Anbindung, oder undefined, wenn sie nie eingerichtet wurde. */
  get(provider: string): Promise<IntegrationState | undefined>;
  /**
   * Zugangsdaten einer eingeschalteten Anbindung. Gibt undefined zurück, wenn sie fehlt oder
   * ausgeschaltet ist — so fragt ein aufrufendes Modul mit einer Zeile, ob es loslegen darf.
   */
  credentials(provider: string): Promise<IntegrationCredentials | undefined>;
  /** Legt an oder ändert. Geheime Felder, die nicht mitkommen, bleiben unverändert. */
  save(input: {
    readonly provider: string;
    readonly enabled: boolean;
    readonly settings: Readonly<Record<string, string>>;
    readonly secrets: Readonly<Record<string, string>>;
  }): Promise<IntegrationState>;
  /** Hält das Ergebnis einer Verbindungsprüfung fest. */
  recordCheck(provider: string, ok: boolean, message: string): Promise<void>;
  /**
   * Schickt dem Händler eine kurze Nachricht über jeden eingeschalteten Nachrichtenweg (heute
   * Telegram). Gibt zurück, über wie viele Wege sie hinausging; 0 heißt „nichts eingerichtet“.
   * Wirft nie: Eine Bestellung darf nicht daran scheitern, dass Telegram gerade klemmt.
   */
  notifyMerchant(text: string): Promise<number>;
}

/** Bindet einen verschlüsselten Wert an Shop und Dienst (siehe secret-box.ts). */
function purposeOf(tenantId: string, provider: string): string {
  return `integrations.${provider}.secrets:${tenantId}`;
}

function asStrings(value: unknown): Record<string, string> {
  if (typeof value !== "object" || value === null) return {};
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(value)) if (typeof v === "string") out[k] = v;
  return out;
}

export function createIntegrations(deps: IntegrationsDependencies): Integrations {
  const db = deps.database as Database<DB>;
  const tenant = () => getContext()?.tenantId ?? "";

  const decrypt = (provider: string, sealed: Buffer | null): Record<string, string> => {
    if (sealed === null) return {};
    const open = deps.secretBox.open(sealed, purposeOf(tenant(), provider));
    return asStrings(JSON.parse(open.toString("utf8")));
  };

  const toState = (row: {
    provider: string;
    enabled: boolean;
    settings: unknown;
    secrets: Buffer | null;
    checked_at: Date | null;
    check_ok: boolean | null;
    check_message: string | null;
  }): IntegrationState => ({
    provider: row.provider,
    enabled: row.enabled,
    settings: asStrings(row.settings),
    secrets: decrypt(row.provider, row.secrets),
    checkedAt: row.checked_at,
    checkOk: row.check_ok,
    checkMessage: row.check_message,
  });

  const read = async (provider?: string) =>
    withTenantTransaction(db, async (trx) => {
      let q = trx
        .selectFrom("integrations.connection")
        .select(["provider", "enabled", "settings", "secrets", "checked_at", "check_ok", "check_message"]);
      if (provider !== undefined) q = q.where("provider", "=", provider);
      return q.orderBy("provider").execute();
    });

  return {
    async list() {
      return (await read()).map(toState);
    },
    async get(provider) {
      const [row] = await read(provider);
      return row === undefined ? undefined : toState(row);
    },
    async credentials(provider) {
      const state = await this.get(provider);
      if (state === undefined || !state.enabled) return undefined;
      return { enabled: true, settings: state.settings, secrets: state.secrets };
    },
    async save(input) {
      const current = await this.get(input.provider);
      // Geheime Felder, die der Browser nicht mitschickt, behalten ihren Wert: Das Backoffice
      // bekommt sie nie zu sehen und könnte sie sonst beim Speichern löschen.
      const merged = Object.fromEntries(
        Object.entries({ ...current?.secrets, ...input.secrets }).filter(([, value]) => value !== ""),
      );
      const sealed =
        Object.keys(merged).length === 0
          ? null
          : deps.secretBox.seal(
              Buffer.from(JSON.stringify(merged), "utf8"),
              purposeOf(tenant(), input.provider),
            );
      await withTenantTransaction(db, async (trx) => {
        await trx
          .insertInto("integrations.connection")
          .values({
            tenant_id: tenant(),
            provider: input.provider,
            enabled: input.enabled,
            settings: JSON.stringify(input.settings),
            secrets: sealed,
          })
          .onConflict((oc) =>
            oc.columns(["tenant_id", "provider"]).doUpdateSet({
              enabled: input.enabled,
              settings: JSON.stringify(input.settings),
              secrets: sealed,
            }),
          )
          .execute();
      });
      const saved = await this.get(input.provider);
      if (saved === undefined) throw new Error("Anbindung konnte nicht gespeichert werden");
      return saved;
    },
    async notifyMerchant(text) {
      const telegram = await this.credentials("telegram");
      if (telegram === undefined) return 0;
      const token = telegram.secrets["botToken"] ?? "";
      const chatId = telegram.settings["chatId"] ?? "";
      if (token === "" || chatId === "") return 0;
      try {
        await fetchExternal({
          url: `https://api.telegram.org/bot${encodeURIComponent(token)}/sendMessage`,
          method: "POST",
          body: { chat_id: chatId, text },
          service: "Telegram",
        });
        return 1;
      } catch {
        return 0;
      }
    },
    async recordCheck(provider, ok, message) {
      await withTenantTransaction(db, async (trx) => {
        await trx
          .updateTable("integrations.connection")
          .set({ checked_at: new Date(), check_ok: ok, check_message: message.slice(0, 500) })
          .where("provider", "=", provider)
          .execute();
      });
    },
  };
}
