import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { allEndpoints, unconnectedDatabase } from "./endpoints.js";
import { runOpenApiCli } from "./openapi-cli.js";
import { buildAllOpenApi, buildOpenApi, lintOpenApi } from "./openapi.js";

const endpoints = allEndpoints({ database: unconnectedDatabase });

describe("OpenAPI (API-03)", () => {
  afterEach(() => vi.restoreAllMocks());

  it("beschreibt jeden Endpunkt mit operationId, Berechtigung und Fehlerantworten", () => {
    const doc = buildOpenApi("admin", endpoints);
    expect(doc["openapi"]).toBe("3.1.0");
    const paths = doc["paths"] as Record<string, Record<string, Record<string, unknown>>>;
    const get = paths["/admin/v1/manufacturers/{manufacturerId}"]?.["get"];
    expect(get?.["operationId"]).toBe("getManufacturer");
    expect(get?.["x-required-scopes"]).toEqual(["products:read"]);
    expect(Object.keys(get?.["responses"] as object)).toEqual([
      "200",
      "401",
      "403",
      "404",
      "422",
      "429",
      "500",
    ]);
    expect(lintOpenApi(doc)).toEqual([]);
  });

  it("jede Operation aller drei APIs erklärt ihre Berechtigung (T-09, statischer Teil)", () => {
    for (const doc of Object.values(buildAllOpenApi(endpoints))) expect(lintOpenApi(doc)).toEqual([]);
  });

  it("die Prüfung findet fehlende Berechtigung und doppelte operationId", () => {
    const doc = {
      paths: {
        "/a": {
          get: { operationId: "x" },
          post: { operationId: "x", "x-required-scopes": ["products:write"] },
        },
        "/b": { get: { "x-public": true } },
      },
    };
    expect(lintOpenApi(doc)).toEqual([
      "GET /a: x-required-scopes fehlt (Standard ist „verboten“)",
      "POST /a: operationId x doppelt",
      "GET /b: operationId fehlt",
      "GET /b: x-required-scopes fehlt (Standard ist „verboten“)",
    ]);
  });

  it("die eingecheckten Dateien sind aktuell", () => {
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    expect(runOpenApiCli(["--check"])).toBe(0);
  });

  it("--check erkennt veraltete und fehlende Dateien", () => {
    const dir = mkdtempSync(join(tmpdir(), "shop-openapi-"));
    try {
      vi.spyOn(console, "log").mockImplementation(() => undefined);
      const err = vi.spyOn(console, "error").mockImplementation(() => undefined);
      expect(runOpenApiCli([], dir)).toBe(0);
      expect(runOpenApiCli(["--check"], dir)).toBe(0);
      const file = join(dir, "openapi/admin.json");
      writeFileSync(file, readFileSync(file, "utf8").replace("listManufacturers", "listHersteller"));
      rmSync(join(dir, "openapi/store.json"));
      expect(runOpenApiCli(["--check"], dir)).toBe(1);
      expect(err.mock.calls.flat().join("\n")).toMatch(
        /admin\.json ist veraltet[\s\S]*store\.json ist veraltet/,
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
