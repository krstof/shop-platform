// T-19: Protokolle enthalten keine Passwörter, Tokens, Cookies und keine vollen IP-Adressen.
import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { runWithContext } from "./context.js";
import { createLogger, isSensitiveKey, redact, REDACTED, scrubText } from "./logger.js";

function capture() {
  const lines: string[] = [];
  const logger = createLogger({ level: "trace", destination: { write: (s: string) => void lines.push(s) } });
  return {
    logger,
    lines,
    records: () => lines.map((l) => JSON.parse(l) as Record<string, unknown>),
    all: () => lines.join("\n"),
  };
}

// Testwerte werden bei jedem Lauf neu ausgewürfelt (keine echt aussehenden Geheimnisse im Code).
// Jeder davon darf nirgends in der Ausgabe auftauchen.
const rnd = (n: number) => randomBytes(n).toString("hex");
const SECRETS = {
  password: `Pw!${rnd(8)}`,
  token: `shp_at_${rnd(20)}`,
  bearer: `${rnd(12)}.${rnd(12)}.${rnd(12)}`,
  cookie: rnd(16),
  apiKey: `k_${rnd(10)}`,
  card: "4111111111111111", // offizielle Testkartennummer
  dbPassword: `pg${rnd(8)}`,
  ip4: "203.0.113.57",
  ip6: "2001:db8:85a3:8d3:1319:8a2e:370:7348",
};

function expectClean(output: string) {
  for (const [name, value] of Object.entries(SECRETS)) {
    expect(output, `${name} steht im Protokoll`).not.toContain(value);
  }
}

describe("T-19: Schwärzung in Protokollen", () => {
  it("schwärzt sensible Felder in jeder Tiefe", () => {
    const { logger, all, records } = capture();
    logger.info(
      {
        user: { email: "kunde@example.test", password: SECRETS.password, newPassword: SECRETS.password },
        req: {
          method: "POST",
          url: "/admin/products",
          headers: {
            authorization: `Bearer ${SECRETS.bearer}`,
            cookie: `__Host-session=${SECRETS.cookie}`,
            "x-api-key": SECRETS.apiKey,
            "user-agent": "Test",
          },
          remoteAddress: SECRETS.ip4,
        },
        res: { headers: { "set-cookie": [`__Host-session=${SECRETS.cookie}; Secure; HttpOnly`] } },
        payment: { card_number: SECRETS.card, cvc: "123" },
        tokens: [{ accessToken: SECRETS.token }],
        deep: { a: { b: { c: { d: { e: { sessionToken: SECRETS.token } } } } } },
      },
      "Anfrage",
    );
    expectClean(all());
    const rec = records()[0] as {
      user: Record<string, unknown>;
      req: { headers: Record<string, unknown>; remoteAddress: string; method: string };
    };
    expect(rec.user["password"]).toBe(REDACTED);
    expect(rec.user["email"]).toBe("kunde@example.test");
    expect(rec.req.headers["user-agent"]).toBe("Test");
    expect(rec.req.method).toBe("POST");
    expect(rec.req.remoteAddress).toBe("203.0.113.0");
  });

  it("schwärzt Geheimnisse in freiem Text, Formatargumenten und Fehlermeldungen", () => {
    const { logger, all } = capture();
    logger.warn(`Anmeldung mit Authorization: Bearer ${SECRETS.bearer} von ${SECRETS.ip4}`);
    logger.info("Weiterleitung nach %s", `/reset?token=${SECRETS.token}&lang=de`);
    logger.error(new Error(`connect postgres://shop_app:${SECRETS.dbPassword}@db:5432/shop fehlgeschlagen`));
    logger.error(
      { err: new Error("äußerer Fehler", { cause: new Error(`Cookie: session=${SECRETS.cookie}`) }) },
      "Fehler",
    );
    logger.info({ clientIp: SECRETS.ip6, msgText: `von ${SECRETS.ip6}` }, "IPv6");
    logger.info({ "x-forwarded-for": `${SECRETS.ip4}, 198.51.100.23` }, "Proxy");
    const out = all();
    expectClean(out);
    expect(out).not.toContain("198.51.100.23");
    expect(out).toContain("2001:db8:85a3::");
    expect(out).toContain("äußerer Fehler");
    expect(out).toContain("lang=de");
    expect(out).toContain('"type":"Error"');
  });

  it("schwärzt auch in gebundenen Feldern von Kind-Protokollen", () => {
    const { logger, all } = capture();
    const kind = logger.child({ apiKey: SECRETS.apiKey, module: "catalog" });
    kind.info("Kind");
    kind.child({ password: SECRETS.password }).info("Enkel");
    const out = all();
    expectClean(out);
    expect(out).toContain('"module":"catalog"');
  });

  it("fügt requestId und tenantId aus dem Anfrage-Kontext hinzu", () => {
    const { logger, records } = capture();
    runWithContext(
      { requestId: "req-1", tenantId: "0192f1c4-7a1e-7c3b-8000-000000000001", correlationId: "corr-1" },
      () => logger.info("im Kontext"),
    );
    logger.info("ohne Kontext");
    const [inCtx, outCtx] = records();
    expect(inCtx).toMatchObject({
      requestId: "req-1",
      tenantId: "0192f1c4-7a1e-7c3b-8000-000000000001",
      correlationId: "corr-1",
      msg: "im Kontext",
      level: "info",
    });
    expect(outCtx).not.toHaveProperty("requestId");
    expect(outCtx).not.toHaveProperty("hostname");
    expect(outCtx).not.toHaveProperty("pid");
  });

  it("verändert das Original nicht und übersteht Kreisverweise", () => {
    const obj: Record<string, unknown> = { password: SECRETS.password };
    obj["self"] = obj;
    const copy = redact(obj) as Record<string, unknown>;
    expect(obj["password"]).toBe(SECRETS.password);
    expect(copy["password"]).toBe(REDACTED);
    expect(copy["self"]).toBe("[Kreisverweis]");
  });

  it("lässt harmlose Felder und Uhrzeiten in Ruhe", () => {
    expect(isSensitiveKey("publicUrl")).toBe(false);
    expect(isSensitiveKey("cardinality")).toBe(false);
    expect(isSensitiveKey("tenantId")).toBe(false);
    expect(isSensitiveKey("requestId")).toBe(false);
    expect(isSensitiveKey("author")).toBe(false);
    for (const k of [
      "password",
      "PASSWORD",
      "x-api-key",
      "set-cookie",
      "refresh_token",
      "accesstoken",
      "privateKey",
    ]) {
      expect(isSensitiveKey(k), k).toBe(true);
    }
    expect(scrubText("Lauf um 14:00:00 Uhr, Version 1.2.3")).toBe("Lauf um 14:00:00 Uhr, Version 1.2.3");
  });
});
