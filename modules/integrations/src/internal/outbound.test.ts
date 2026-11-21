// Der gemeinsame Weg nach außen: Fehler fremder Dienste werden zu Sätzen, die man einem Händler
// zeigen kann, und ein zu großer oder hängender Dienst bringt den Shop nicht aus dem Tritt.
import { afterEach, describe, expect, it, vi } from "vitest";
import { ExternalServiceError, fetchExternal } from "./outbound.js";

function response(status: number, body: string): Response {
  return new Response(body, { status, headers: { "content-type": "application/json" } });
}

describe("fetchExternal", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("gibt die Antwort als JSON zurück", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => response(200, JSON.stringify({ ok: true, wert: 7 }))),
    );
    await expect(
      fetchExternal<{ wert: number }>({ url: "https://dienst.test/a", service: "Dienst" }),
    ).resolves.toEqual({ ok: true, wert: 7 });
  });

  it("sagt bei falschen Zugangsdaten, dass sie nicht stimmen", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => response(401, "{}")),
    );
    await expect(fetchExternal({ url: "https://dienst.test/a", service: "Telegram" })).rejects.toThrow(
      /Die Zugangsdaten stimmen nicht/,
    );
  });

  it("wiederholt bei einer Störung genau einmal", async () => {
    const calls = vi.fn();
    let n = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        calls();
        n += 1;
        return n === 1 ? response(503, "{}") : response(200, "{}");
      }),
    );
    await expect(fetchExternal({ url: "https://dienst.test/a", service: "Dienst" })).resolves.toEqual({});
    expect(calls).toHaveBeenCalledTimes(2);
  });

  it("wiederholt bei einer abgelehnten Anfrage nicht", async () => {
    const calls = vi.fn();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        calls();
        return response(400, "{}");
      }),
    );
    await expect(fetchExternal({ url: "https://dienst.test/a", service: "Dienst" })).rejects.toBeInstanceOf(
      ExternalServiceError,
    );
    expect(calls).toHaveBeenCalledTimes(1);
  });

  it("meldet einen Dienst, der nicht erreichbar ist", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("connect ECONNREFUSED");
      }),
    );
    await expect(fetchExternal({ url: "https://dienst.test/a", service: "DeepL" })).rejects.toThrow(
      /DeepL ist nicht erreichbar/,
    );
  });

  it("bricht ab, wenn der Dienst zu viele Daten schickt", async () => {
    const riesig = "x".repeat(3 * 1024 * 1024);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => response(200, riesig)),
    );
    await expect(fetchExternal({ url: "https://dienst.test/a", service: "Dienst" })).rejects.toThrow(
      /zu viele Daten/,
    );
  });

  it("meldet eine Antwort, die kein JSON ist", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("<html>Fehlerseite</html>", { status: 200 })),
    );
    await expect(fetchExternal({ url: "https://dienst.test/a", service: "Dienst" })).rejects.toThrow(
      /unerwartet geantwortet/,
    );
  });
});
