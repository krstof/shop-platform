// Anbindungen an fremde Dienste (21.11.2026): speichern, prüfen, ein- und ausschalten.
// Wichtigster Punkt: Zugangsdaten stehen verschlüsselt in der Datenbank und kommen nie zurück.
// Braucht SHOP_TEST_DATABASE_URL (pnpm test:with-db), sonst übersprungen; in der CI Pflicht.
import { randomBytes } from "node:crypto";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { AuthenticatedActor } from "@shop/http";
import { connectDatabase, createLogger, createSecretBox, uuidv7, type Database } from "@shop/kernel";
import { runMigrations } from "@shop/kernel/migrate";
import { roleUrl } from "@shop/testing";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { ActorResolver } from "./actor.js";
import { createApi } from "./app.js";
import { allEndpoints } from "./endpoints.js";
import { databaseIdempotencyStore } from "./idempotency-store.js";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const adminUrl = process.env["SHOP_TEST_DATABASE_URL"];
if (process.env["SHOP_REQUIRE_DB_TESTS"] === "true" && adminUrl === undefined) {
  throw new Error("SHOP_TEST_DATABASE_URL fehlt, obwohl SHOP_REQUIRE_DB_TESTS=true gesetzt ist");
}

const TENANT_A = uuidv7();
const TENANT_B = uuidv7();
const TOKEN = "987654321:GEHEIM-NICHT-IN-DER-DATENBANK";

const resolver: ActorResolver = async ({ headers }) => {
  const shop = headers["x-test-shop"];
  if (shop !== "a" && shop !== "b" && shop !== "a-lesen") return undefined;
  const auth: AuthenticatedActor = {
    actor: { type: "user", id: uuidv7() },
    tenantId: shop === "b" ? TENANT_B : TENANT_A,
    scopes: new Set(
      shop === "a-lesen" ? ["settings:read"] : ["settings:read", "settings:write", "products:write"],
    ),
  };
  return auth;
};

describe.skipIf(adminUrl === undefined)("Anbindungen", () => {
  const dbName = `api_integrations_${randomBytes(4).toString("hex")}`;
  let admin: pg.Client;
  let inspect: pg.Client;
  let database: Database<unknown>;
  let app: NestFastifyApplication;

  const inject = (
    method: "GET" | "POST" | "PUT",
    url: string,
    payload?: object,
    headers: Record<string, string> = {},
  ) =>
    app
      .getHttpAdapter()
      .getInstance()
      .inject({ method, url, headers, ...(payload === undefined ? {} : { payload }) });
  const asA = { "x-test-shop": "a" };
  const asB = { "x-test-shop": "b" };

  beforeAll(async () => {
    admin = new pg.Client({ connectionString: adminUrl });
    await admin.connect();
    await admin.query(`CREATE DATABASE ${dbName}`);
    const setupUrl = new URL(adminUrl ?? "");
    setupUrl.pathname = `/${dbName}`;
    await runMigrations({ connectionString: setupUrl.href, rootDir: repoRoot });
    inspect = new pg.Client({ connectionString: setupUrl.href });
    await inspect.connect();
    for (const [id, handle] of [
      [TENANT_A, "teeladen"],
      [TENANT_B, "modeladen"],
    ] as const) {
      await inspect.query(
        `WITH m AS (INSERT INTO platform.merchant (name) VALUES ($2) RETURNING id)
         INSERT INTO platform.tenant (id, merchant_id, plan_id, handle, name, status)
         SELECT $1, m.id, p.id, $2, $2, 'active' FROM m, platform.plan p WHERE p.is_default`,
        [id, handle],
      );
    }
    database = connectDatabase<unknown>({
      connectionString: roleUrl(adminUrl ?? "", dbName, "shop_app"),
      maxConnections: 4,
      applicationName: "api-integrations-test",
    });
    app = await createApi({
      endpoints: allEndpoints({
        database,
        secretBox: createSecretBox(new Map([[1, randomBytes(32)]])),
      }),
      resolveActor: resolver,
      logger: createLogger({ level: "silent" }),
      idempotency: databaseIdempotencyStore(database),
    });
  }, 60_000);

  afterAll(async () => {
    await app?.close();
    await database?.destroy();
    await inspect?.end();
    if (admin !== undefined) {
      await admin.query(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`);
      await admin.end();
    }
  });

  it("zeigt den Katalog, auch bevor etwas eingerichtet ist", async () => {
    const r = await inject("GET", "/admin/v1/integrations", undefined, asA);
    expect(r.statusCode).toBe(200);
    const body = r.json() as { data: { provider: string; enabled: boolean; fields: { key: string }[] }[] };
    const telegram = body.data.find((i) => i.provider === "telegram");
    expect(telegram?.enabled).toBe(false);
    expect(telegram?.fields.map((f) => f.key)).toContain("botToken");
  });

  it("lässt sich nicht einschalten, solange ein Pflichtfeld fehlt", async () => {
    const r = await inject(
      "PUT",
      "/admin/v1/integrations",
      { provider: "telegram", enabled: true, values: {} },
      asA,
    );
    expect(r.statusCode).toBe(422);
    expect(r.json()).toMatchObject({
      detail: expect.stringContaining("Schlüssel des Bots") as unknown as string,
    });
  });

  it("speichert den Schlüssel, gibt ihn aber nie zurück", async () => {
    const saved = await inject(
      "PUT",
      "/admin/v1/integrations",
      { provider: "telegram", enabled: true, values: { botToken: TOKEN } },
      asA,
    );
    expect(saved.statusCode).toBe(200);
    const body = saved.json() as {
      enabled: boolean;
      fields: { key: string; filled: boolean; value: string }[];
    };
    expect(body.enabled).toBe(true);
    const token = body.fields.find((f) => f.key === "botToken");
    expect(token?.filled).toBe(true);
    expect(token?.value).toBe("");
    expect(JSON.stringify(body)).not.toContain(TOKEN);
  });

  it("legt den Schlüssel verschlüsselt ab", async () => {
    const rows = await inspect.query<{ secrets: Buffer }>(`SELECT secrets FROM integrations.connection`);
    expect(rows.rows).toHaveLength(1);
    expect(rows.rows[0]?.secrets.includes(Buffer.from(TOKEN, "utf8"))).toBe(false);
  });

  it("behält den Schlüssel, wenn beim Speichern nur andere Felder kommen", async () => {
    const r = await inject(
      "PUT",
      "/admin/v1/integrations",
      { provider: "telegram", enabled: true, values: { chatId: "4711" } },
      asA,
    );
    expect(r.statusCode).toBe(200);
    const body = r.json() as { fields: { key: string; filled: boolean; value: string }[] };
    expect(body.fields.find((f) => f.key === "botToken")?.filled).toBe(true);
    expect(body.fields.find((f) => f.key === "chatId")?.value).toBe("4711");
  });

  it("schaltet aus, ohne die Zugangsdaten zu verlieren", async () => {
    const off = await inject(
      "PUT",
      "/admin/v1/integrations",
      { provider: "telegram", enabled: false, values: {} },
      asA,
    );
    expect(off.statusCode).toBe(200);
    const body = off.json() as { enabled: boolean; fields: { key: string; filled: boolean }[] };
    expect(body.enabled).toBe(false);
    expect(body.fields.find((f) => f.key === "botToken")?.filled).toBe(true);
  });

  it("kennt keine erfundenen Felder", async () => {
    const r = await inject(
      "PUT",
      "/admin/v1/integrations",
      { provider: "telegram", enabled: false, values: { heimlich: "x" } },
      asA,
    );
    expect(r.statusCode).toBe(422);
  });

  it("kennt keine erfundene Anbindung", async () => {
    const r = await inject(
      "PUT",
      "/admin/v1/integrations",
      { provider: "gibtsnicht", enabled: false, values: {} },
      asA,
    );
    expect(r.statusCode).toBe(404);
  });

  it("zeigt einem anderen Shop nichts davon", async () => {
    const r = await inject("GET", "/admin/v1/integrations", undefined, asB);
    const body = r.json() as {
      data: { provider: string; enabled: boolean; fields: { filled: boolean }[] }[];
    };
    const telegram = body.data.find((i) => i.provider === "telegram");
    expect(telegram?.enabled).toBe(false);
    expect(telegram?.fields.every((f) => !f.filled)).toBe(true);
  });

  it("sucht ohne Unsplash-Schlüssel nur bei Openverse", async () => {
    const urls: string[] = [];
    const echt = globalThis.fetch;
    globalThis.fetch = (async (input: Parameters<typeof fetch>[0]) => {
      urls.push(String(input));
      return new Response(JSON.stringify({ results: [] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }) as typeof fetch;
    try {
      const r = await inject("GET", "/admin/v1/stock-photos?query=tee", undefined, asB);
      expect(r.statusCode).toBe(200);
      expect(r.json()).toMatchObject({ sources: ["openverse"] });
      expect(urls.every((u) => u.startsWith("https://api.openverse.org/"))).toBe(true);
    } finally {
      globalThis.fetch = echt;
    }
  });

  it("gibt die Treffer von Openverse verständlich zurück", async () => {
    const echt = globalThis.fetch;
    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({
          results: [
            {
              id: "abc",
              title: "Teekanne",
              thumbnail: "https://api.openverse.org/v1/images/abc/thumb/",
              url: "https://bilder.test/abc.jpg",
              width: 1024,
              height: 768,
              license: "cc0",
              foreign_landing_url: "https://quelle.test/abc",
            },
          ],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      )) as typeof fetch;
    try {
      const r = await inject("GET", "/admin/v1/stock-photos?query=tee", undefined, asB);
      const body = r.json() as { data: { source: string; license: string; title: string }[] };
      expect(body.data).toHaveLength(1);
      expect(body.data[0]).toMatchObject({ source: "openverse", license: "CC0", title: "Teekanne" });
    } finally {
      globalThis.fetch = echt;
    }
  });

  it("meldet einen Ausfall der Bildersuche als Fehler, nicht als „nichts gefunden“", async () => {
    const echt = globalThis.fetch;
    globalThis.fetch = (async () => {
      throw new Error("kein Netz");
    }) as typeof fetch;
    try {
      const r = await inject("GET", "/admin/v1/stock-photos?query=tee", undefined, asB);
      expect(r.statusCode).toBeGreaterThanOrEqual(400);
    } finally {
      globalThis.fetch = echt;
    }
  });

  it("holt kein Bild von einer Adresse im eigenen Netz", async () => {
    const echt = globalThis.fetch;
    const geholt: string[] = [];
    globalThis.fetch = (async (input: Parameters<typeof fetch>[0]) => {
      geholt.push(String(input));
      return new Response(JSON.stringify({ url: "http://garage:3900/geheim.jpg" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }) as typeof fetch;
    try {
      const r = await inject(
        "POST",
        "/admin/v1/stock-photos/download",
        { source: "openverse", id: "abc" },
        asB,
      );
      expect(r.statusCode).toBeGreaterThanOrEqual(400);
      expect(geholt.some((u) => u.includes("garage"))).toBe(false);
    } finally {
      globalThis.fetch = echt;
    }
  });

  it("lässt nur schreiben, wer das Recht dazu hat", async () => {
    const r = await inject(
      "PUT",
      "/admin/v1/integrations",
      { provider: "telegram", enabled: false, values: {} },
      { "x-test-shop": "a-lesen" },
    );
    expect(r.statusCode).toBe(403);
  });
});
