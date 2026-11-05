// Worker Ende zu Ende mit echter Datenbank (Etappe E5): Ereignisse der Hersteller landen genau
// einmal im Änderungsprotokoll, auch nach Neustart des Workers, doppelter Aufgabe und mit zwei
// Workern gleichzeitig. Braucht SHOP_TEST_DATABASE_URL (pnpm test:with-db), sonst übersprungen.
import { randomBytes } from "node:crypto";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { manufacturerCreated, manufacturerUpdated } from "@shop/catalog";
import {
  connectDatabase,
  createLogger,
  publishEvent,
  runWithContext,
  uuidv7,
  withTenantTransaction,
  type Database,
  type EventEnvelope,
} from "@shop/kernel";
import { runMigrations } from "@shop/kernel/migrate";
import { roleUrl } from "@shop/testing";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { allSubscribers } from "./subscribers.js";
import { CLEANUP_QUEUE, startWorker, type RunningWorker } from "./worker.js";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const adminUrl = process.env["SHOP_TEST_DATABASE_URL"];
if (process.env["SHOP_REQUIRE_DB_TESTS"] === "true" && adminUrl === undefined) {
  throw new Error("SHOP_TEST_DATABASE_URL fehlt, obwohl SHOP_REQUIRE_DB_TESTS=true gesetzt ist");
}

const TENANT_A = uuidv7();
const TENANT_B = uuidv7();
const USER_A = uuidv7();
const logger = createLogger({
  level: (process.env["SHOP_TEST_LOG"] ?? "silent") as "silent",
  name: "worker-test",
});

async function waitFor(check: () => Promise<boolean>, timeoutMs = 20_000): Promise<void> {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    if (await check()) return;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error("Zeit abgelaufen");
}

describe.skipIf(adminUrl === undefined)("Worker Ende zu Ende (echte Datenbank)", () => {
  const dbName = `worker_test_${randomBytes(4).toString("hex")}`;
  let admin: pg.Client;
  let setup: pg.Client;
  let appDatabase: Database<unknown>;
  let relayDatabase: Database<unknown>;
  let relayUrl: string;
  const running: RunningWorker[] = [];

  async function start(): Promise<RunningWorker> {
    const w = await startWorker({
      appDatabase,
      relayDatabase,
      queueConnectionString: relayUrl,
      subscribers: allSubscribers(),
      logger,
      pollingIntervalSeconds: 0.5,
      relayIdleMs: 100,
    });
    running.push(w);
    return w;
  }

  async function stop(w: RunningWorker): Promise<void> {
    await w.stop();
    running.splice(running.indexOf(w), 1);
  }

  /** Einträge im Protokoll zu den Objekten dieser Ereignisse (jedes Ereignis hat ein eigenes Objekt). */
  async function auditCount(eventIds: readonly string[]): Promise<number> {
    const r = await setup.query<{ n: string }>(
      `SELECT count(*) AS n FROM audit.audit_entry
        WHERE entity_id IN (SELECT (data->>'id')::uuid FROM kernel.outbox WHERE id = ANY($1::uuid[]))`,
      [eventIds],
    );
    return Number(r.rows[0]?.n);
  }

  async function entriesFor(entityId: string) {
    const r = await setup.query(
      `SELECT tenant_id, actor_type, actor_id, action, entity_type, entity_id, changes, correlation_id
         FROM audit.audit_entry WHERE entity_id = $1 ORDER BY id`,
      [entityId],
    );
    return r.rows;
  }

  function asUser<T>(tenantId: string, fn: () => Promise<T>, correlationId = uuidv7()): Promise<T> {
    return runWithContext(
      { requestId: uuidv7(), correlationId, tenantId, actor: { type: "user", id: USER_A } },
      fn,
    );
  }

  async function created(tenantId: string, id = uuidv7(), name = "Teehaus"): Promise<EventEnvelope> {
    return asUser(tenantId, () =>
      withTenantTransaction(appDatabase, (trx) => publishEvent(trx, manufacturerCreated, { id, name })),
    );
  }

  beforeAll(async () => {
    admin = new pg.Client({ connectionString: adminUrl });
    await admin.connect();
    await admin.query(`CREATE DATABASE ${dbName}`);
    const setupUrl = new URL(adminUrl ?? "");
    setupUrl.pathname = `/${dbName}`;
    await runMigrations({ connectionString: setupUrl.href, rootDir: repoRoot });
    setup = new pg.Client({ connectionString: setupUrl.href });
    await setup.connect();
    for (const [id, handle] of [
      [TENANT_A, "teeladen-a"],
      [TENANT_B, "modeladen-b"],
    ] as const) {
      await setup.query(
        `WITH m AS (INSERT INTO platform.merchant (name) VALUES ($2) RETURNING id)
         INSERT INTO platform.tenant (id, merchant_id, plan_id, handle, name, status)
         SELECT $1, m.id, p.id, $2, $2, 'active' FROM m, platform.plan p WHERE p.is_default`,
        [id, handle],
      );
    }
    appDatabase = connectDatabase({ connectionString: roleUrl(adminUrl ?? "", dbName, "shop_app") });
    relayUrl = roleUrl(adminUrl ?? "", dbName, "shop_relay");
    relayDatabase = connectDatabase({ connectionString: relayUrl });
  }, 120_000);

  afterAll(async () => {
    for (const w of [...running]) await w.stop();
    await appDatabase?.destroy();
    await relayDatabase?.destroy();
    await setup?.end();
    await admin?.query(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`);
    await admin?.end();
  });

  it("schreibt Anlegen und Ändern eines Herstellers genau einmal ins Änderungsprotokoll", async () => {
    const worker = await start();
    try {
      const id = uuidv7();
      const correlationId = uuidv7();
      await asUser(
        TENANT_A,
        () =>
          withTenantTransaction(appDatabase, async (trx) => {
            await publishEvent(trx, manufacturerCreated, { id, name: "Teehaus Hamburg" });
            await publishEvent(trx, manufacturerUpdated, {
              id,
              changes: { website_url: [null, "https://teehaus.example"] },
            });
          }),
        correlationId,
      );
      await waitFor(async () => (await entriesFor(id)).length === 2);
      expect(await entriesFor(id)).toEqual([
        {
          tenant_id: TENANT_A,
          actor_type: "user",
          actor_id: USER_A,
          action: "catalog.manufacturer.created.v1",
          entity_type: "catalog.manufacturer",
          entity_id: id,
          changes: null,
          correlation_id: correlationId,
        },
        {
          tenant_id: TENANT_A,
          actor_type: "user",
          actor_id: USER_A,
          action: "catalog.manufacturer.updated.v1",
          entity_type: "catalog.manufacturer",
          entity_id: id,
          changes: { website_url: [null, "https://teehaus.example"] },
          correlation_id: correlationId,
        },
      ]);
      // Dieselbe Aufgabe ein zweites Mal (etwa nach einem Absturz vor dem Quittieren).
      const event = await setup.query(`SELECT id FROM kernel.outbox WHERE data->>'id' = $1 ORDER BY id`, [
        id,
      ]);
      const firstId = event.rows[0]?.id as string;
      const job = await setup.query(`SELECT data FROM pgboss.job WHERE name = 'audit.record' AND id = $1`, [
        firstId,
      ]);
      await worker.queue.boss.send("audit.record", job.rows[0]?.data as object);
      await waitFor(async () => {
        const r = await setup.query(
          `SELECT count(*) AS n FROM pgboss.job WHERE name = 'audit.record' AND state = 'completed' AND data->>'id' = $1`,
          [firstId],
        );
        return Number(r.rows[0]?.n) === 2;
      });
      expect(await entriesFor(id)).toHaveLength(2);
    } finally {
      await stop(worker);
    }
  }, 60_000);

  it("Ereignisse während der Worker steht, kommen nach dem Start genau einmal an", async () => {
    const events = [await created(TENANT_A), await created(TENANT_B), await created(TENANT_A)];
    const ids = events.map((e) => e.id);
    expect(await auditCount(ids)).toBe(0);
    const worker = await start();
    await waitFor(async () => (await auditCount(ids)) === 3);
    await stop(worker);
    // Neustart: nichts wird erneut verarbeitet.
    const again = await start();
    await new Promise((r) => setTimeout(r, 1500));
    expect(await auditCount(ids)).toBe(3);
    await stop(again);
  }, 60_000);

  it("zwei Worker gleichzeitig: 200 Ereignisse aus zwei Shops, jedes genau einmal im Protokoll", async () => {
    const [one, two] = [await start(), await start()];
    try {
      const ids: string[] = [];
      for (const tenant of [TENANT_A, TENANT_B]) {
        await asUser(tenant, () =>
          withTenantTransaction(appDatabase, async (trx) => {
            for (let i = 0; i < 100; i++) {
              ids.push((await publishEvent(trx, manufacturerCreated, { id: uuidv7(), name: `H${i}` })).id);
            }
          }),
        );
      }
      await waitFor(async () => (await auditCount(ids)) === 200, 40_000);
      const r = await setup.query<{ n: string }>(
        `SELECT count(*) AS n FROM audit.processed_event WHERE event_id = ANY($1::uuid[])`,
        [ids],
      );
      expect(Number(r.rows[0]?.n)).toBe(200);
      const byTenant = await setup.query(
        `SELECT tenant_id, count(*)::int AS n FROM audit.audit_entry a
          WHERE a.action = 'catalog.manufacturer.created.v1' AND a.entity_id IN (
            SELECT (data->>'id')::uuid FROM kernel.outbox WHERE id = ANY($1::uuid[]))
          GROUP BY tenant_id ORDER BY tenant_id`,
        [ids],
      );
      expect(byTenant.rows).toEqual([TENANT_A, TENANT_B].sort().map((tenant_id) => ({ tenant_id, n: 100 })));
    } finally {
      await stop(one);
      await stop(two);
    }
  }, 90_000);

  it("Protokolleinträge eines Shops sind für den anderen unsichtbar und unveränderlich", async () => {
    const id = uuidv7();
    const worker = await start();
    try {
      await created(TENANT_B, id);
      await waitFor(async () => (await entriesFor(id)).length === 1);
    } finally {
      await stop(worker);
    }
    const seenFromA = await withTenantTransaction(
      appDatabase as Database<{ "audit.audit_entry": { entity_id: string } }>,
      (trx) => trx.selectFrom("audit.audit_entry").select("entity_id").where("entity_id", "=", id).execute(),
      { tenantId: TENANT_A },
    );
    expect(seenFromA).toEqual([]);
    await expect(
      withTenantTransaction(
        appDatabase as Database<{ "audit.audit_entry": { entity_id: string; action: string } }>,
        (trx) =>
          trx
            .updateTable("audit.audit_entry")
            .set({ action: "verändert" })
            .where("entity_id", "=", id)
            .execute(),
        { tenantId: TENANT_B },
      ),
    ).rejects.toThrow(/permission denied/);
  }, 60_000);

  it("plant das stündliche Aufräumen genau einmal ein", async () => {
    const [one, two] = [await start(), await start()];
    try {
      const r = await setup.query(`SELECT name, cron FROM pgboss.schedule WHERE name = $1`, [CLEANUP_QUEUE]);
      expect(r.rows).toEqual([{ name: CLEANUP_QUEUE, cron: "17 * * * *" }]);
      // Aufgabe von Hand auslösen: läuft als shop_relay und löscht abgelaufene Schlüssel.
      await setup.query(
        `INSERT INTO kernel.idempotency_key (tenant_id, scope, key, request_hash, expires_at)
         VALUES ($1, 'test', 'abgelaufen-1', '\\x00', now() - interval '1 hour')`,
        [TENANT_A],
      );
      await one.queue.boss.send(CLEANUP_QUEUE, {});
      await waitFor(async () => {
        const k = await setup.query(
          `SELECT count(*) AS n FROM kernel.idempotency_key WHERE key = 'abgelaufen-1'`,
        );
        return Number(k.rows[0]?.n) === 0;
      });
    } finally {
      await stop(one);
      await stop(two);
    }
  }, 60_000);
});
