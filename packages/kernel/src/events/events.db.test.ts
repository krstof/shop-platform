// Outbox, Relay, Warteschlange und Zustellung mit echter PostgreSQL-Datenbank (Etappe E5, ADR-007).
// Fertig-Kriterium der Etappe: Ein Ereignis kommt genau einmal beim Abonnenten an, auch bei
// Wiederholung. Geprüft mit doppelter Zustellung, gleichzeitiger Zustellung, Fehler mit
// Wiederholung durch pg-boss, scheiterndem Relay und mehreren Relays gleichzeitig.
// Braucht SHOP_TEST_DATABASE_URL (pnpm test:with-db), sonst übersprungen; in der CI Pflicht.
import { randomBytes } from "node:crypto";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { sql } from "kysely";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";
import { runWithContext } from "../context.js";
import { connectDatabase, withTenantTransaction, type Database } from "../db/database.js";
import { runMigrations } from "../db/migrate.js";
import { uuidv7 } from "../id.js";
import { cleanupExpired } from "../jobs/cleanup.js";
import { JobSchemaMismatchError, startJobQueue, type JobQueue } from "../jobs/queue.js";
import { defineEvent, publishEvent, type EventEnvelope } from "./event.js";
import { relayOutboxOnce, startRelay } from "./relay.js";
import { defineSubscriber, deliverEvent, type Subscriber } from "./subscriber.js";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
const adminUrl = process.env["SHOP_TEST_DATABASE_URL"];
if (process.env["SHOP_REQUIRE_DB_TESTS"] === "true" && adminUrl === undefined) {
  throw new Error("SHOP_TEST_DATABASE_URL fehlt, obwohl SHOP_REQUIRE_DB_TESTS=true gesetzt ist");
}

const TENANT_A = uuidv7();
const TENANT_B = uuidv7();
const USER = uuidv7();

const thingCreated = defineEvent(
  "catalog.thing.created.v1",
  z.strictObject({ id: z.uuid(), name: z.string() }),
);
const thingDeleted = defineEvent("catalog.thing.deleted.v1", z.strictObject({ id: z.uuid() }));

/** Wie roleUrl aus @shop/testing (der Kernel darf das Testpaket nicht importieren). */
function asRole(url: string, role: string): string {
  const u = new URL(url);
  u.searchParams.set("options", `-c role=${role}`);
  return u.href;
}

async function waitFor(check: () => Promise<boolean>, timeoutMs = 20_000): Promise<void> {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    if (await check()) return;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error("Zeit abgelaufen");
}

describe.skipIf(adminUrl === undefined)("Outbox, Relay und Zustellung (echte Datenbank)", () => {
  const dbName = `events_test_${randomBytes(4).toString("hex")}`;
  let setupUrl: string;
  let admin: pg.Client;
  let setup: pg.Client;
  let app: Database<unknown>;
  let relayDb: Database<unknown>;
  let queue: JobQueue;

  /**
   * Test-Subscriber mit Wirkung in derselben Transaktion: schreibt je Ereignis einen Eintrag ins
   * Änderungsprotokoll. Die Zahl der Einträge zeigt, wie oft die Wirkung eingetreten ist.
   */
  function counter(name: string, onHandle?: (event: EventEnvelope) => void): Subscriber {
    return defineSubscriber<unknown>({
      name,
      events: [thingCreated],
      handle: async (trx, event) => {
        await sql`insert into audit.audit_entry (tenant_id, actor_type, action, entity_type, entity_id)
                  values (kernel.current_tenant_id(), 'system', ${name}, 'test', ${event.data["id"]})`.execute(
          trx,
        );
        onHandle?.(event);
      },
    });
  }

  async function effects(name: string, entityId?: string): Promise<number> {
    const r = await setup.query<{ n: string }>(
      `SELECT count(*) AS n FROM audit.audit_entry WHERE action = $1 AND ($2::uuid IS NULL OR entity_id = $2)`,
      [name, entityId ?? null],
    );
    return Number(r.rows[0]?.n);
  }

  async function publishThing(tenantId: string, name = "Tee"): Promise<EventEnvelope> {
    return runWithContext({ requestId: uuidv7(), tenantId, actor: { type: "user", id: USER } }, () =>
      withTenantTransaction(app, (trx) => publishEvent(trx, thingCreated, { id: uuidv7(), name })),
    );
  }

  async function unpublished(): Promise<number> {
    const r = await setup.query<{ n: string }>(
      `SELECT count(*) AS n FROM kernel.outbox WHERE published_at IS NULL`,
    );
    return Number(r.rows[0]?.n);
  }

  async function jobsIn(queueName: string): Promise<number> {
    const r = await setup.query<{ n: string }>(`SELECT count(*) AS n FROM pgboss.job WHERE name = $1`, [
      queueName,
    ]);
    return Number(r.rows[0]?.n);
  }

  beforeAll(async () => {
    admin = new pg.Client({ connectionString: adminUrl });
    await admin.connect();
    await admin.query(`CREATE DATABASE ${dbName}`);
    const u = new URL(adminUrl ?? "");
    u.pathname = `/${dbName}`;
    setupUrl = u.href;
    await runMigrations({ connectionString: setupUrl, rootDir: repoRoot });
    setup = new pg.Client({ connectionString: setupUrl });
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
    app = connectDatabase({ connectionString: asRole(setupUrl, "shop_app") });
    relayDb = connectDatabase({ connectionString: asRole(setupUrl, "shop_relay") });
    queue = await startJobQueue({
      connectionString: asRole(setupUrl, "shop_relay"),
      pollingIntervalSeconds: 0.5,
    });
  }, 120_000);

  afterAll(async () => {
    await queue?.stop();
    await app?.destroy();
    await relayDb?.destroy();
    await setup?.end();
    await admin?.query(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`);
    await admin?.end();
  });

  // --- Ereignisse beschreiben und schreiben ---

  it("defineEvent verlangt Namensmuster und strenges Schema", () => {
    expect(() => defineEvent("catalog.thing.created", z.strictObject({}))).toThrow(/passt nicht/);
    expect(() => defineEvent("Catalog.thing.created.v1", z.strictObject({}))).toThrow(/passt nicht/);
    expect(() => defineEvent("catalog.thing.created.v1", z.object({ id: z.uuid() }))).toThrow(/strictObject/);
    expect(() => defineEvent("catalog.thing.created.v1", z.looseObject({ id: z.uuid() }))).toThrow(
      /strictObject/,
    );
  });

  it("publishEvent schreibt Hülle mit Shop aus der Transaktion, Urheber und Vorgang aus dem Kontext", async () => {
    const correlationId = uuidv7();
    const id = uuidv7();
    const event = await runWithContext(
      { requestId: uuidv7(), correlationId, tenantId: TENANT_A, actor: { type: "user", id: USER } },
      () => withTenantTransaction(app, (trx) => publishEvent(trx, thingCreated, { id, name: "Grüner Tee" })),
    );
    expect(event).toMatchObject({
      type: "catalog.thing.created.v1",
      tenantId: TENANT_A,
      actor: { type: "user", id: USER },
      correlationId,
      causationId: null,
      data: { id, name: "Grüner Tee" },
    });
    const row = await setup.query(`SELECT * FROM kernel.outbox WHERE id = $1`, [event.id]);
    expect(row.rows[0]).toMatchObject({
      tenant_id: TENANT_A,
      type: "catalog.thing.created.v1",
      actor: { type: "user", id: USER },
      correlation_id: correlationId,
      data: { id, name: "Grüner Tee" },
      published_at: null,
    });
  });

  it("rollt die Transaktion zurück, verschwindet auch das Ereignis", async () => {
    const before = await setup.query(`SELECT count(*) FROM kernel.outbox`);
    await expect(
      runWithContext({ requestId: uuidv7(), tenantId: TENANT_A }, () =>
        withTenantTransaction(app, async (trx) => {
          await publishEvent(trx, thingCreated, { id: uuidv7(), name: "x" });
          throw new Error("Abbruch");
        }),
      ),
    ).rejects.toThrow("Abbruch");
    const after = await setup.query(`SELECT count(*) FROM kernel.outbox`);
    expect(after.rows[0]).toEqual(before.rows[0]);
  });

  it("falsche oder zusätzliche Daten werden gar nicht erst geschrieben", async () => {
    const run = (data: unknown) =>
      runWithContext({ requestId: uuidv7(), tenantId: TENANT_A }, () =>
        withTenantTransaction(app, (trx) =>
          publishEvent(trx, thingCreated, data as { id: string; name: string }),
        ),
      );
    await expect(run({ id: "keine-uuid", name: "x" })).rejects.toThrow();
    await expect(run({ id: uuidv7(), name: "x", geheim: "passwort" })).rejects.toThrow();
  });

  it("Shop A sieht die Ereignisse von Shop B nicht, shop_app erreicht die Warteschlange nicht", async () => {
    const b = await publishThing(TENANT_B);
    const seen = await withTenantTransaction(
      app,
      (trx) => sql<{ id: string }>`select id from kernel.outbox where id = ${b.id}`.execute(trx),
      { tenantId: TENANT_A },
    );
    expect(seen.rows).toEqual([]);
    await expect(
      withTenantTransaction(app, (trx) => sql`select count(*) from pgboss.job`.execute(trx), {
        tenantId: TENANT_A,
      }),
    ).rejects.toThrow(/permission denied/);
  });

  // --- Relay ---

  it("Relay stellt je Subscriber genau eine Aufgabe ein und markiert die Ereignisse", async () => {
    await relayOutboxOnce({ database: relayDb, queue, subscribers: [] }); // Altlasten der Tests oben
    const subA = counter("audit.relay_a");
    const subB = defineSubscriber({ name: "audit.relay_b", events: [thingDeleted], handle: async () => {} });
    await queue.ensureQueue(subA.name);
    await queue.ensureQueue(subB.name);
    const events = [await publishThing(TENANT_A), await publishThing(TENANT_B)];
    expect(await unpublished()).toBe(2);
    const first = await relayOutboxOnce({ database: relayDb, queue, subscribers: [subA, subB] });
    expect(first).toEqual({ published: 2, jobs: 2 });
    expect(await unpublished()).toBe(0);
    expect(await jobsIn(subA.name)).toBe(2);
    expect(await jobsIn(subB.name)).toBe(0); // hört nicht auf created
    const job = await setup.query(`SELECT id, data FROM pgboss.job WHERE name = $1 AND id = $2`, [
      subA.name,
      events[0]?.id,
    ]);
    expect(job.rows[0]?.data).toEqual(events[0]);
    expect(await relayOutboxOnce({ database: relayDb, queue, subscribers: [subA, subB] })).toEqual({
      published: 0,
      jobs: 0,
    });
  });

  it("scheitert das Einstellen, bleibt das Ereignis unveröffentlicht und kommt später genau einmal", async () => {
    const sub = counter("audit.relay_missing_queue"); // Warteschlange gibt es noch nicht
    const event = await publishThing(TENANT_A);
    await expect(relayOutboxOnce({ database: relayDb, queue, subscribers: [sub] })).rejects.toThrow();
    const row = await setup.query(
      `SELECT published_at, attempts, last_error FROM kernel.outbox WHERE id = $1`,
      [event.id],
    );
    expect(row.rows[0]).toMatchObject({ published_at: null, attempts: 1 });
    expect(row.rows[0]?.last_error).toMatch(/.+/);
    expect(await jobsIn(sub.name)).toBe(0);

    await queue.ensureQueue(sub.name);
    expect(await relayOutboxOnce({ database: relayDb, queue, subscribers: [sub] })).toEqual({
      published: 1,
      jobs: 1,
    });
    const after = await setup.query(
      `SELECT published_at, attempts, last_error FROM kernel.outbox WHERE id = $1`,
      [event.id],
    );
    expect(after.rows[0]).toMatchObject({ attempts: 2, last_error: null });
    expect(after.rows[0]?.published_at).not.toBeNull();
    expect(await jobsIn(sub.name)).toBe(1);
  });

  it("vier Relays gleichzeitig stellen 300 Ereignisse je genau einmal ein", async () => {
    const sub = counter("audit.relay_parallel");
    await queue.ensureQueue(sub.name);
    const ids: string[] = [];
    await runWithContext({ requestId: uuidv7(), tenantId: TENANT_A }, () =>
      withTenantTransaction(app, async (trx) => {
        for (let i = 0; i < 300; i++)
          ids.push((await publishEvent(trx, thingCreated, { id: uuidv7(), name: `n${i}` })).id);
      }),
    );
    const results = await Promise.all(
      [1, 2, 3, 4].map(() =>
        relayOutboxOnce({ database: relayDb, queue, subscribers: [sub], batchSize: 40 }),
      ),
    );
    let total = results.reduce((s, r) => s + r.published, 0);
    while ((await unpublished()) > 0) {
      total += (await relayOutboxOnce({ database: relayDb, queue, subscribers: [sub], batchSize: 40 }))
        .published;
    }
    expect(total).toBe(300);
    const r = await setup.query<{ n: string; d: string }>(
      `SELECT count(*) AS n, count(DISTINCT id) AS d FROM pgboss.job WHERE name = $1 AND id = ANY($2::uuid[])`,
      [sub.name, ids],
    );
    expect(r.rows[0]).toEqual({ n: "300", d: "300" });
  });

  // --- Zustellung genau einmal ---

  it("doppelte und gleichzeitige Zustellung: Wirkung genau einmal", async () => {
    const sub = counter("audit.deliver_twice");
    const event = await publishThing(TENANT_A);
    expect(await deliverEvent(app, sub, event)).toBe("processed");
    expect(await deliverEvent(app, sub, event)).toBe("duplicate");
    expect(await effects(sub.name, String(event.data["id"]))).toBe(1);

    const other = await publishThing(TENANT_B);
    const results = await Promise.all([1, 2, 3, 4, 5].map(() => deliverEvent(app, sub, other)));
    expect(results.filter((r) => r === "processed")).toHaveLength(1);
    expect(results.filter((r) => r === "duplicate")).toHaveLength(4);
    expect(await effects(sub.name, String(other.data["id"]))).toBe(1);
  });

  it("die Inbox gilt je Subscriber: ein zweiter Subscriber bekommt dasselbe Ereignis auch", async () => {
    const one = counter("audit.inbox_one");
    const two = counter("audit.inbox_two");
    const event = await publishThing(TENANT_A);
    expect(await deliverEvent(app, one, event)).toBe("processed");
    expect(await deliverEvent(app, two, event)).toBe("processed");
  });

  it("Zustellung prüft Hülle, Ereignistyp und Daten", async () => {
    const sub = counter("audit.deliver_checks");
    const event = await publishThing(TENANT_A);
    await expect(deliverEvent(app, sub, { ...event, id: "x" })).rejects.toThrow(/Hülle/);
    await expect(deliverEvent(app, sub, { ...event, extra: 1 })).rejects.toThrow(/Hülle/);
    await expect(deliverEvent(app, sub, { ...event, type: "catalog.thing.deleted.v1" })).rejects.toThrow(
      /hört nicht/,
    );
    await expect(deliverEvent(app, sub, { ...event, data: { id: uuidv7() } })).rejects.toThrow(/Schema/);
    await expect(deliverEvent(app, sub, { ...event, tenantId: null })).rejects.toThrow(/Plattform/);
    expect(await effects(sub.name)).toBe(0);
  });

  it("Folgeereignisse tragen Vorgang und Ursache weiter", async () => {
    const follow = defineSubscriber<unknown>({
      name: "audit.follow_up",
      events: [thingCreated],
      handle: async (trx, event) => {
        await publishEvent(trx, thingDeleted, { id: String(event.data["id"]) });
      },
    });
    const event = await publishThing(TENANT_B);
    await deliverEvent(app, follow, event);
    const r = await setup.query(
      `SELECT tenant_id, actor, correlation_id, causation_id FROM kernel.outbox WHERE causation_id = $1`,
      [event.id],
    );
    expect(r.rows).toEqual([
      {
        tenant_id: TENANT_B,
        actor: { type: "system" },
        correlation_id: event.correlationId,
        causation_id: event.id,
      },
    ]);
  });

  it("Ende zu Ende: Fehler, Wiederholung durch pg-boss und erneutes Einstellen ändern nichts an genau einmal", async () => {
    let calls = 0;
    let failNext = true;
    const sub = counter("audit.end_to_end", () => {
      calls += 1;
      // Erster Versuch scheitert NACH der Wirkung: Sie muss mit zurückgerollt werden.
      if (failNext) {
        failNext = false;
        throw new Error("vorübergehender Fehler");
      }
    });
    await queue.ensureQueue(sub.name, {
      retryLimit: 3,
      retryDelay: 1,
      retryBackoff: false,
      partition: false,
    });
    // Ältere, nie weitergeleitete Ereignisse der Tests oben vorher abräumen.
    while ((await relayOutboxOnce({ database: relayDb, queue, subscribers: [] })).published > 0);
    const results: string[] = [];
    await queue.work(sub.name, async (job) => {
      results.push(await deliverEvent(app, sub, job.data));
    });
    const relay = startRelay({ database: relayDb, queue, subscribers: [sub], idleMs: 100 });
    try {
      const event = await publishThing(TENANT_A, "Rooibos");
      const id = String(event.data["id"]);
      await waitFor(async () => results.includes("processed"));
      expect(calls).toBe(2);
      expect(await effects(sub.name, id)).toBe(1);
      const job = await setup.query(`SELECT state, retry_count FROM pgboss.job WHERE name = $1 AND id = $2`, [
        sub.name,
        event.id,
      ]);
      expect(job.rows[0]).toMatchObject({ state: "completed", retry_count: 1 });

      // Dieselbe Aufgabe noch einmal (etwa nach einem Absturz vor dem Quittieren): keine zweite Wirkung.
      await queue.boss.send(sub.name, event);
      await waitFor(async () => results.includes("duplicate"));
      expect(await effects(sub.name, id)).toBe(1);
      // Dieselbe Job-ID nimmt die Warteschlange gar nicht erst zweimal an.
      await queue.boss.insert(sub.name, [{ id: event.id, data: event }]);
      expect(await jobsIn(sub.name)).toBe(2);
    } finally {
      await relay.stop();
    }
  }, 60_000);

  // --- Warteschlange und Aufräumen ---

  it("startet nicht, wenn die Schema-Version der Warteschlange nicht passt", async () => {
    await setup.query(`UPDATE pgboss.version SET version = version - 1`);
    try {
      await expect(
        startJobQueue({ connectionString: asRole(setupUrl, "shop_relay") }),
      ).rejects.toBeInstanceOf(JobSchemaMismatchError);
    } finally {
      await setup.query(`UPDATE pgboss.version SET version = version + 1`);
    }
  });

  it("räumt abgelaufene Idempotenz-Schlüssel und alte veröffentlichte Ereignisse auf, sonst nichts", async () => {
    const hash = Buffer.from("00", "hex");
    for (const [tenant, key, expired] of [
      [TENANT_A, "abgelaufen-a", true],
      [TENANT_B, "abgelaufen-b", true],
      [TENANT_A, "noch-gueltig", false],
    ] as const) {
      await setup.query(
        `INSERT INTO kernel.idempotency_key (tenant_id, scope, key, request_hash, expires_at)
         VALUES ($1, 'test', $2, $3, now() + ($4 || ' hours')::interval)`,
        [tenant, key, hash, expired ? "-1" : "1"],
      );
    }
    const old = await publishThing(TENANT_A, "alt");
    const fresh = await publishThing(TENANT_A, "neu");
    const pending = await publishThing(TENANT_B, "offen");
    await setup.query(`UPDATE kernel.outbox SET published_at = now() - interval '31 days' WHERE id = $1`, [
      old.id,
    ]);
    await setup.query(`UPDATE kernel.outbox SET published_at = now() WHERE id = $1`, [fresh.id]);
    await setup.query(`UPDATE kernel.outbox SET occurred_at = now() - interval '60 days' WHERE id = $1`, [
      pending.id,
    ]);

    const result = await cleanupExpired(relayDb);
    expect(result.idempotencyKeys).toBe(2);
    expect(result.outboxEvents).toBeGreaterThanOrEqual(1);
    const keys = await setup.query(`SELECT key FROM kernel.idempotency_key ORDER BY key`);
    expect(keys.rows.map((r: { key: string }) => r.key)).toEqual(["noch-gueltig"]);
    const left = await setup.query(`SELECT id FROM kernel.outbox WHERE id = ANY($1::uuid[]) ORDER BY id`, [
      [old.id, fresh.id, pending.id],
    ]);
    expect(left.rows.map((r: { id: string }) => r.id)).toEqual([fresh.id, pending.id].sort());
    await expect(cleanupExpired(relayDb, { outboxRetentionDays: 0 })).rejects.toThrow(RangeError);
  });

  it("shop_relay darf gültige Idempotenz-Schlüssel weder sehen noch löschen", async () => {
    const r = await withRelayCheck(`SELECT count(*)::int AS n FROM kernel.idempotency_key`);
    expect(r).toBe(0); // nur abgelaufene wären sichtbar, und die sind schon weg
    await expect(withRelayCheck(`SELECT request_hash FROM kernel.idempotency_key`)).rejects.toThrow(
      /permission denied/,
    );
    await expect(withRelayCheck(`SELECT count(*)::int AS n FROM catalog.manufacturer`)).rejects.toThrow(
      /permission denied/,
    );
  });

  async function withRelayCheck(query: string): Promise<number> {
    const c = new pg.Client({ connectionString: asRole(setupUrl, "shop_relay") });
    await c.connect();
    try {
      const r = await c.query<{ n: number }>(query);
      return r.rows[0]?.n ?? 0;
    } finally {
      await c.end();
    }
  }
});
