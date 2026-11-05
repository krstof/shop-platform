// Lebenszeichen des Workers (E5 Teil 2): Regel „gesund“ und der kleine Server dafür.
import { request } from "node:http";
import { networkInterfaces } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { evaluateHealth, startHealthServer, type RunningHealthServer } from "./health.js";

describe("Regel für „gesund“", () => {
  const t0 = 1_000_000;
  it("frisch gestartet ohne Durchgang: gesund bis zum Ende der Anlaufzeit, dann nicht", () => {
    const s = { stopping: false, startedAt: t0, lastSuccessAt: undefined };
    expect(evaluateHealth(s, t0 + 59_000)).toBe(true);
    expect(evaluateHealth(s, t0 + 61_000)).toBe(false);
  });
  it("letzter fehlerfreier Durchgang zählt, nicht der Start", () => {
    const s = { stopping: false, startedAt: t0, lastSuccessAt: t0 + 300_000 };
    expect(evaluateHealth(s, t0 + 330_000)).toBe(true);
    expect(evaluateHealth(s, t0 + 361_000)).toBe(false);
  });
  it("beim Anhalten nie gesund", () => {
    expect(evaluateHealth({ stopping: true, startedAt: t0, lastSuccessAt: t0 }, t0)).toBe(false);
  });
  it("Grenzen lassen sich einstellen", () => {
    const s = { stopping: false, startedAt: t0, lastSuccessAt: t0 };
    expect(evaluateHealth(s, t0 + 2_000, { maxSilenceMs: 1_000 })).toBe(false);
  });
});

function call(port: number, method: string, path: string, host = "127.0.0.1") {
  return new Promise<{ status: number; body: string; headers: Record<string, unknown> }>(
    (resolve, reject) => {
      const req = request({ host, port, method, path, timeout: 2_000 }, (res) => {
        let body = "";
        res.on("data", (c: Buffer) => (body += c.toString()));
        res.on("end", () => resolve({ status: res.statusCode ?? 0, body, headers: res.headers }));
      });
      req.on("error", reject);
      req.on("timeout", () => req.destroy(new Error("timeout")));
      req.end();
    },
  );
}

describe("Server für /livez", () => {
  let server: RunningHealthServer | undefined;
  let healthy = true;
  afterEach(async () => {
    await server?.close();
    server = undefined;
  });

  it("200 wenn gesund, 503 wenn nicht, ohne weitere Angaben", async () => {
    server = await startHealthServer({ port: 0, isHealthy: () => healthy });
    healthy = true;
    const ok = await call(server.port, "GET", "/livez");
    expect(ok).toMatchObject({ status: 200, body: '{"status":"ok"}' });
    expect(ok.headers["cache-control"]).toBe("no-store");
    expect(ok.headers["x-content-type-options"]).toBe("nosniff");
    healthy = false;
    expect(await call(server.port, "GET", "/livez")).toMatchObject({
      status: 503,
      body: '{"status":"unavailable"}',
    });
    expect((await call(server.port, "HEAD", "/livez")).status).toBe(503);
  });

  it("wirft die Prüfung einen Fehler, gilt der Worker als nicht gesund", async () => {
    server = await startHealthServer({
      port: 0,
      isHealthy: () => {
        throw new Error("kaputt");
      },
    });
    expect((await call(server.port, "GET", "/livez")).status).toBe(503);
  });

  it("nur /livez, nur GET und HEAD", async () => {
    server = await startHealthServer({ port: 0, isHealthy: () => true });
    expect((await call(server.port, "GET", "/")).status).toBe(404);
    expect((await call(server.port, "GET", "/livez/../metrics")).status).toBe(404);
    const post = await call(server.port, "POST", "/livez");
    expect(post.status).toBe(405);
    expect(post.headers["allow"]).toBe("GET, HEAD");
    expect((await call(server.port, "GET", "/livez?x=1")).status).toBe(200);
  });

  it("lauscht nur auf 127.0.0.1, nicht auf anderen Adressen des Rechners", async () => {
    server = await startHealthServer({ port: 0, isHealthy: () => true });
    const other = Object.values(networkInterfaces())
      .flat()
      .find((a) => a !== undefined && a.family === "IPv4" && !a.internal)?.address;
    if (other === undefined) return; // Rechner ohne weitere Adresse: nichts zu prüfen
    await expect(call(server.port, "GET", "/livez", other)).rejects.toThrow();
  });
});
