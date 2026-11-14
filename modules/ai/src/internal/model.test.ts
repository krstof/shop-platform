import { describe, expect, it } from "vitest";
import { anthropicModel, ModelUnavailableError } from "./model.js";
import { SYSTEM_PROMPT, TOOLS } from "./tools.js";

function fakeFetch(status: number, body: unknown) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fn = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return new Response(typeof body === "string" ? body : JSON.stringify(body), { status });
  }) as unknown as typeof fetch;
  return { fn, calls };
}

const request = {
  system: SYSTEM_PROMPT,
  tools: TOOLS,
  messages: [{ role: "user" as const, content: [{ type: "text" as const, text: "Hallo" }] }],
};

describe("Sprachmodell über die Messages-API", () => {
  it("schickt Modell, Anweisungen, Werkzeuge und Verlauf und liest Text und Werkzeugaufrufe", async () => {
    const { fn, calls } = fakeFetch(200, {
      content: [
        { type: "text", text: "Ich schaue nach." },
        { type: "tool_use", id: "toolu_1", name: "search_orders", input: { state: "to_ship" } },
        { type: "thinking", thinking: "…" },
      ],
      usage: { input_tokens: 120, output_tokens: 30 },
    });
    const model = anthropicModel({
      apiKey: "sk-test",
      model: "claude-sonnet-5-5",
      baseUrl: "http://gw:8095/",
      fetch: fn,
    });
    const reply = await model.reply(request);
    expect(reply).toEqual({
      content: [
        { type: "text", text: "Ich schaue nach." },
        { type: "tool_use", id: "toolu_1", name: "search_orders", input: { state: "to_ship" } },
      ],
      inputTokens: 120,
      outputTokens: 30,
    });
    expect(calls[0]?.url).toBe("http://gw:8095/v1/messages");
    const headers = calls[0]?.init.headers as Record<string, string>;
    expect(headers["x-api-key"]).toBe("sk-test");
    expect(headers["anthropic-version"]).toBe("2023-06-01");
    const sent = JSON.parse(String(calls[0]?.init.body));
    expect(sent.model).toBe("claude-sonnet-5-5");
    expect(sent.system).toBe(SYSTEM_PROMPT);
    expect(sent.tools).toHaveLength(TOOLS.length);
    expect(sent.tools[0]).toEqual({
      name: TOOLS[0]?.name,
      description: TOOLS[0]?.description,
      input_schema: TOOLS[0]?.inputSchema,
    });
    expect(sent.messages).toEqual(request.messages);
  });

  it("meldet Fehler des Modells als ModelUnavailableError, ohne den Schlüssel zu verraten", async () => {
    const { fn } = fakeFetch(401, { error: { message: "invalid x-api-key" } });
    const model = anthropicModel({ apiKey: "sk-geheim", model: "m", fetch: fn });
    const error = await model.reply(request).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ModelUnavailableError);
    expect(String((error as Error).message)).toContain("401");
    expect(String((error as Error).message)).not.toContain("sk-geheim");
  });

  it("meldet ein unerreichbares Modell", async () => {
    const fn = (async () => {
      throw new TypeError("fetch failed");
    }) as unknown as typeof fetch;
    const model = anthropicModel({ apiKey: "k", model: "m", fetch: fn });
    await expect(model.reply(request)).rejects.toBeInstanceOf(ModelUnavailableError);
  });
});

describe("Werkzeuge", () => {
  it("haben eindeutige Namen und ein Objekt-Schema", () => {
    expect(new Set(TOOLS.map((t) => t.name)).size).toBe(TOOLS.length);
    for (const t of TOOLS) {
      expect(t.name).toMatch(/^[a-z_]{3,64}$/);
      expect(t.inputSchema["type"]).toBe("object");
    }
  });

  it("markieren genau die ändernden Werkzeuge", () => {
    expect(TOOLS.filter((t) => t.changes).map((t) => t.name)).toEqual([
      "create_product",
      "update_product",
      "copy_product",
      "add_product_photo",
      "create_category",
      "mark_order_shipped",
      "cancel_order",
      "set_order_note",
      "update_shipping",
      "create_coupon",
    ]);
  });
});
