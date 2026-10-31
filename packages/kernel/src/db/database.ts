// Einziger Weg zur Datenbank (Architektur 5.3, Sicherheit 5.4, PLA-03).
//
// Die Kysely-Instanz und der Verbindungspool sind in diesem Modul eingeschlossen und
// werden nicht exportiert. Zugriff gibt es nur über `withTenantTransaction`, das in
// einer Transaktion als Erstes den Mandanten mit `set_config(..., true)` setzt. Der Wert
// gilt nur für diese Transaktion. Ohne Mandant greift die RLS-Regel geschlossen: keine Zeilen.
import { Kysely, PostgresDialect, sql, type IsolationLevel, type Transaction } from "kysely";
import pg from "pg";
import { getContext } from "../context.js";
import { isUuid } from "../id.js";

export type { Transaction } from "kysely";

export interface DatabaseOptions {
  /** Adresse inklusive Rolle, zum Beispiel für `shop_app`. Außerhalb von local mit `sslmode=verify-full`. */
  readonly connectionString: string;
  /** Höchstzahl gleichzeitiger Verbindungen. Standard 10. */
  readonly maxConnections?: number;
  /** Erscheint in `pg_stat_activity`, hilft bei der Fehlersuche. */
  readonly applicationName?: string;
  /** Abbruch einer einzelnen Abfrage nach so vielen Millisekunden. Standard 15000. */
  readonly statementTimeoutMs?: number;
  /**
   * Wird aufgerufen, wenn eine ruhende Verbindung abbricht (zum Beispiel Neustart der Datenbank).
   * Ohne diesen Empfänger würde der ganze Prozess abstürzen. Die Verbindung wird verworfen
   * und bei Bedarf neu aufgebaut.
   */
  readonly onConnectionError?: (error: Error) => void;
}

/** Undurchsichtiger Griff auf eine Datenbank. Von außen lässt sich damit nichts direkt abfragen. */
export interface Database<DB> {
  /** Nur zur Typprüfung, existiert zur Laufzeit nicht. */
  readonly __schema?: DB;
  destroy(): Promise<void>;
}

const handles = new WeakMap<object, Kysely<unknown>>();

class DatabaseHandle<DB> implements Database<DB> {
  declare readonly __schema?: DB;
  async destroy(): Promise<void> {
    const db = handles.get(this);
    handles.delete(this);
    await db?.destroy();
  }
}

export function connectDatabase<DB>(options: DatabaseOptions): Database<DB> {
  const pool = new pg.Pool({
    connectionString: options.connectionString,
    max: options.maxConnections ?? 10,
    application_name: options.applicationName ?? "shop",
    statement_timeout: options.statementTimeoutMs ?? 15_000,
    // Verbindungen ohne Transaktion offen zu halten bringt nichts und verdeckt Lecks.
    idle_in_transaction_session_timeout: 30_000,
  });
  pool.on("error", (error) => options.onConnectionError?.(error));
  const db = new Kysely<DB>({ dialect: new PostgresDialect({ pool }) });
  const handle = new DatabaseHandle<DB>();
  handles.set(handle, db as Kysely<unknown>);
  return handle;
}

function kyselyOf<DB>(database: Database<DB>): Kysely<DB> {
  const db = handles.get(database);
  if (db === undefined) throw new Error("Datenbank ist nicht verbunden oder bereits geschlossen");
  return db as Kysely<DB>;
}

export class MissingTenantError extends Error {
  constructor() {
    super("Kein Mandant gesetzt: Datenbankzugriff verweigert");
    this.name = "MissingTenantError";
  }
}

export interface TenantTransactionOptions {
  /** Mandant. Ohne Angabe wird er aus dem Anfrage-Kontext genommen. */
  readonly tenantId?: string;
  /** Urheber für `created_by` und `updated_by`. Ohne Angabe aus dem Anfrage-Kontext. */
  readonly actorId?: string;
  readonly isolationLevel?: IsolationLevel;
}

async function run<DB, T>(
  database: Database<DB>,
  tenantId: string,
  actorId: string,
  isolationLevel: IsolationLevel | undefined,
  fn: (trx: Transaction<DB>) => Promise<T>,
): Promise<T> {
  const db = kyselyOf(database);
  const builder =
    isolationLevel === undefined ? db.transaction() : db.transaction().setIsolationLevel(isolationLevel);
  return builder.execute(async (trx) => {
    // Werte als Parameter, nie als Text in der Abfrage. `true` = nur für diese Transaktion.
    await sql`select set_config('app.tenant_id', ${tenantId}, true), set_config('app.actor_id', ${actorId}, true)`.execute(
      trx,
    );
    return fn(trx);
  });
}

function resolveActor(explicit: string | undefined): string {
  const actorId = explicit ?? getContext()?.actor?.id ?? "";
  if (actorId !== "" && !isUuid(actorId)) throw new TypeError("actorId muss eine UUID sein");
  return actorId;
}

/**
 * Führt `fn` in einer Transaktion für genau einen Mandanten aus. Wirft ein Fehler,
 * wird alles zurückgerollt. Fehlt der Mandant oder ist er keine UUID, wird gar nicht
 * erst mit der Datenbank gesprochen (Prüfungen schlagen geschlossen fehl, Sicherheit 5.13).
 */
export async function withTenantTransaction<DB, T>(
  database: Database<DB>,
  fn: (trx: Transaction<DB>) => Promise<T>,
  options: TenantTransactionOptions = {},
): Promise<T> {
  const tenantId = options.tenantId ?? getContext()?.tenantId;
  if (tenantId === undefined || tenantId === "") throw new MissingTenantError();
  if (!isUuid(tenantId)) throw new TypeError("tenantId muss eine UUID sein");
  return run(database, tenantId, resolveActor(options.actorId), options.isolationLevel, fn);
}

/**
 * Transaktion ohne Mandant, nur für die Plattform-Verwaltung mit der Rolle `shop_platform`
 * (Händler und Shops anlegen). Die RLS-Regeln zeigen dabei nur Zeilen ohne Shop.
 * Fachmodule benutzen immer `withTenantTransaction`.
 */
export async function withPlatformTransaction<DB, T>(
  database: Database<DB>,
  fn: (trx: Transaction<DB>) => Promise<T>,
  options: Omit<TenantTransactionOptions, "tenantId"> = {},
): Promise<T> {
  return run(database, "", resolveActor(options.actorId), options.isolationLevel, fn);
}

/**
 * Nur für Tests, nicht über das Paket exportiert: liest eine Einstellung auf einer Verbindung
 * aus dem Pool, ohne Transaktion und ohne vorher etwas zu setzen. Damit prüft der Test,
 * dass der Mandant nach dem Ende einer Transaktion nicht an der Verbindung hängen bleibt.
 */
export async function readSessionSettingForTest(
  database: Database<unknown>,
  name: string,
): Promise<string | null> {
  const db = kyselyOf(database);
  const { rows } = await sql<{ v: string | null }>`select current_setting(${name}, true) as v`.execute(db);
  return rows[0]?.v ?? null;
}
