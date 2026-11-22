// Verbindungsprüfung Telegram: Sie muss den Händler Schritt für Schritt ans Ziel führen, also sagen,
// was noch fehlt, statt nur „Fehler“ zu melden.
import { afterEach, describe, expect, it, vi } from "vitest";
import { runCheck } from "./checks.js";
import type { IntegrationState } from "./store.js";

function state(secrets: Record<string, string>, settings: Record<string, string> = {}): IntegrationState {
  return {
    provider: "telegram",
    enabled: true,
    settings,
    secrets,
    checkedAt: null,
    checkOk: null,
    checkMessage: null,
  };
}

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
}

describe("Verbindungsprüfung Telegram", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("sagt, wenn gar kein Schlüssel hinterlegt ist", async () => {
    await expect(runCheck("telegram", state({}))).resolves.toEqual({
      ok: false,
      message: "Es ist kein Schlüssel hinterlegt.",
    });
  });

  it("sagt, wenn Telegram den Schlüssel nicht kennt", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => json({ ok: false })),
    );
    const result = await runCheck("telegram", state({ botToken: "falsch" }));
    expect(result).toEqual({ ok: false, message: "Telegram kennt diesen Schlüssel nicht." });
  });

  it("bittet darum, dem Bot einmal zu schreiben, solange die Chat-Nummer fehlt", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) =>
        url.includes("getMe")
          ? json({ ok: true, result: { username: "teeladen_bot" } })
          : json({ ok: true, result: [] }),
      ),
    );
    const result = await runCheck("telegram", state({ botToken: "123:AA" }));
    expect(result.ok).toBe(false);
    expect(result.message).toContain("teeladen_bot");
    expect(result.message).toContain("Hallo");
  });

  it("merkt sich die Chat-Nummer aus der ersten Nachricht und schickt einen Test", async () => {
    const calls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        calls.push(url);
        if (url.includes("getMe")) return json({ ok: true, result: { username: "teeladen_bot" } });
        if (url.includes("getUpdates"))
          return json({ ok: true, result: [{ message: { chat: { id: 4711 } } }] });
        return json({ ok: true });
      }),
    );
    const result = await runCheck("telegram", state({ botToken: "123:AA" }));
    expect(result.ok).toBe(true);
    expect(result.settings).toEqual({ chatId: "4711" });
    expect(calls.some((u) => u.includes("sendMessage"))).toBe(true);
  });

  it("macht aus einem Fehler des Dienstes eine verständliche Meldung", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("{}", { status: 401 })),
    );
    const result = await runCheck("telegram", state({ botToken: "123:AA" }));
    expect(result).toEqual({ ok: false, message: "Telegram: Die Zugangsdaten stimmen nicht." });
  });

  it("sagt bei einer unbekannten Anbindung, dass sie sich nicht prüfen lässt", async () => {
    await expect(runCheck("gibtsnicht", state({}))).resolves.toEqual({
      ok: false,
      message: "Diese Anbindung lässt sich nicht prüfen.",
    });
  });
});
