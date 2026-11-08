import { describe, expect, it } from "vitest";
import { z } from "zod";
import { IdempotencyInProgressError, IdempotencyKeyReusedError } from "./db/idempotency.js";
import { PROBLEM_TITLES } from "./problem-texts.js";
import {
  BadRequestError,
  ConflictError,
  CrossOriginRejectedError,
  ForbiddenError,
  ReauthenticationRequiredError,
  InvalidCredentialsError,
  InvalidSecondFactorError,
  MethodNotAllowedError,
  NotFoundError,
  PayloadTooLargeError,
  PreconditionFailedError,
  PreconditionRequiredError,
  PROBLEM_TYPE_BASE,
  RateLimitedError,
  ServiceUnavailableError,
  UnauthorizedError,
  UnsupportedMediaTypeError,
  zodErrorMap,
  toJsonPointer,
  toProblemDetails,
  validationErrorFromZod,
  ValidationError,
} from "./problem.js";

const REQ = "0192f1c4-7a1e-7c3b-8000-000000000001";

describe("Problem Details (RFC 9457)", () => {
  it("baut die Antwort aus einem fachlichen Fehler", () => {
    const p = toProblemDetails(new ConflictError({ detail: "Bestellung ist schon versendet." }), REQ);
    expect(p).toEqual({
      type: `${PROBLEM_TYPE_BASE}conflict`,
      title: "Die Aktion passt nicht zum aktuellen Zustand.",
      status: 409,
      code: "conflict",
      detail: "Bestellung ist schon versendet.",
      requestId: REQ,
    });
  });

  it("verrät bei unerwarteten Fehlern keine Einzelheiten", () => {
    const err = new Error('relation "orders.order" does not exist at /app/modules/orders/db.ts:42');
    const p = toProblemDetails(err, REQ);
    expect(p).toEqual({
      type: `${PROBLEM_TYPE_BASE}internal-error`,
      title: "Ein unerwarteter Fehler ist aufgetreten.",
      status: 500,
      code: "internal_error",
      requestId: REQ,
    });
    expect(JSON.stringify(p)).not.toMatch(/relation|orders|\.ts|\/app/);
  });

  it("behandelt auch Nicht-Fehler (geworfene Texte, null) als 500", () => {
    expect(toProblemDetails("kaputt", REQ).status).toBe(500);
    expect(toProblemDetails(null, REQ).status).toBe(500);
  });

  it("gibt die Ursache eines fachlichen Fehlers nie heraus", () => {
    const p = toProblemDetails(new NotFoundError({ cause: new Error("SELECT * FROM geheim") }), REQ);
    expect(JSON.stringify(p)).not.toContain("geheim");
    expect(p.status).toBe(404);
    expect(p).not.toHaveProperty("detail");
  });

  it("hat feste Codes und Status", () => {
    expect(toProblemDetails(new RateLimitedError(), REQ)).toMatchObject({
      status: 429,
      code: "rate_limited",
    });
  });
});

describe("Zod-Fehler als Feldfehler", () => {
  const schema = z.strictObject({
    variants: z.array(z.strictObject({ price: z.strictObject({ amount: z.number().int().positive() }) })),
    name: z.string().min(1),
  });

  it("liefert JSON-Pointer-Pfade und Codes", () => {
    const r = schema.safeParse({ variants: [{ price: { amount: 0 } }], name: "", tenantId: "x" });
    expect(r.success).toBe(false);
    if (r.success) return;
    const e = validationErrorFromZod(r.error);
    expect(e).toBeInstanceOf(ValidationError);
    const p = toProblemDetails(e, REQ);
    expect(p.status).toBe(422);
    expect(p.detail).toBe("3 Felder sind fehlerhaft.");
    const paths = (p.errors ?? []).map((x) => x.path).sort();
    expect(paths).toEqual(["/name", "/tenantId", "/variants/0/price/amount"]);
    expect(p.errors?.find((x) => x.path === "/tenantId")?.code).toBe("unrecognized_keys");
  });

  it("maskiert Sonderzeichen im Pfad", () => {
    expect(toJsonPointer(["a/b", "c~d", 0])).toBe("/a~1b/c~0d/0");
  });
});

describe("RateLimitedError", () => {
  it("trägt die Wartezeit, ohne sie in die Antwort zu schreiben", () => {
    const e = new RateLimitedError({ retryAfterSeconds: 7 });
    expect(e.retryAfterSeconds).toBe(7);
    expect(new RateLimitedError().retryAfterSeconds).toBeUndefined();
    expect(Object.keys(toProblemDetails(e, REQ))).not.toContain("retryAfterSeconds");
  });
});

describe("Fehlertexte in zwei Sprachen", () => {
  const classes = [
    new ValidationError(),
    new BadRequestError(),
    new UnauthorizedError(),
    new ForbiddenError(),
    new ReauthenticationRequiredError(),
    new InvalidCredentialsError(),
    new InvalidSecondFactorError(),
    new CrossOriginRejectedError(),
    new NotFoundError(),
    new MethodNotAllowedError(),
    new ConflictError(),
    new PreconditionFailedError(),
    new PreconditionRequiredError(),
    new IdempotencyKeyReusedError(),
    new IdempotencyInProgressError(),
    new PayloadTooLargeError(),
    new UnsupportedMediaTypeError(),
    new RateLimitedError(),
    new ServiceUnavailableError(),
  ];

  it.each(classes.map((e) => [e.code, e] as const))(
    "%s hat einen deutschen und einen englischen Titel",
    (code, e) => {
      const texts = PROBLEM_TITLES[code];
      expect(texts?.de).toBe(e.title);
      expect(texts?.en).toMatch(/^[A-Z].+\.$/);
      expect(toProblemDetails(e, REQ, "en").title).toBe(texts?.en);
    },
  );

  it("auch der allgemeine 500er kommt auf Englisch", () => {
    expect(toProblemDetails(new Error("x"), REQ, "en").title).toBe("An unexpected error occurred.");
  });

  it("Zod-Meldungen und Zusammenfassung folgen der Sprache, unbekannte Felder einzeln", () => {
    const schema = z.strictObject({ name: z.string().min(3) });
    for (const [locale, detail, unknown] of [
      ["de", "2 Felder sind fehlerhaft.", "Dieses Feld ist nicht erlaubt."],
      ["en", "2 fields are invalid.", "This field is not allowed."],
    ] as const) {
      const r = schema.safeParse({ name: "x", tenantId: "y" }, { error: zodErrorMap(locale) });
      expect(r.success).toBe(false);
      if (r.success) continue;
      const v = validationErrorFromZod(r.error, locale, "/body");
      expect(v.detail).toBe(detail);
      expect(v.errors?.map((e) => e.path)).toEqual(["/body/name", "/body/tenantId"]);
      expect(v.errors?.[1]?.message).toBe(unknown);
    }
    const de = schema.safeParse({ name: "x" }, { error: zodErrorMap("de") });
    const en = schema.safeParse({ name: "x" }, { error: zodErrorMap("en") });
    expect(de.error?.issues[0]?.message).not.toBe(en.error?.issues[0]?.message);
  });
});
