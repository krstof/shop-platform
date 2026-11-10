// EINZIGE öffentliche Datei des Moduls payments (Architektur 3.3, Regel 3).
// MVP-Etappe M6: nur die Testzahlung. Sie tut so, als wäre sie ein gehosteter Zahlungsanbieter:
// Die Kundin bekommt eine Zahlungsseite (über ein geheimes Token) und wählt „bezahlen“ oder
// „ablehnen“. Echte Anbieter (Stripe, PayPal) kommen später hinter dieselbe Fassade.
import { createHash, randomBytes } from "node:crypto";
import { getContext, withTenantTransaction, type Database } from "@shop/kernel";
import type { DB } from "./db.generated.js";

export interface PaymentsDependencies {
  /** Verbindung als Rolle shop_app. */
  readonly database: Database<unknown>;
}

export type PaymentStatus = "pending" | "captured" | "failed";

export interface TestPayment {
  readonly id: string;
  readonly orderId: string;
  readonly amount: number;
  readonly currency: string;
  readonly status: PaymentStatus;
  /** Wie oft schon abgelehnt wurde. */
  readonly declinedAttempts: number;
}

export interface Payments {
  /** Legt eine offene Testzahlung an; das Token für die Zahlungsseite gibt es nur hier. */
  createTestPayment(input: { orderId: string; amount: number; currency: string }): Promise<{ token: string }>;
  findTestPayment(token: string): Promise<TestPayment | undefined>;
  /**
   * Ergebnis der Testzahlung. Nur eine offene Zahlung ändert sich; eine schon bezahlte bleibt
   * bezahlt (zweimal klicken bucht nicht zweimal). Gibt den neuen Stand zurück.
   */
  completeTestPayment(token: string, outcome: "paid" | "declined"): Promise<TestPayment | undefined>;
}

export const PAYMENT_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const PROVIDER = "test";

function reference(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function createPayments(deps: PaymentsDependencies): Payments {
  const db = deps.database as Database<DB>;
  const tenant = () => getContext()?.tenantId ?? "";

  async function load(token: string, lock: boolean): Promise<TestPayment | undefined> {
    if (!PAYMENT_TOKEN_PATTERN.test(token)) return undefined;
    return withTenantTransaction(db, async (trx) => {
      let q = trx
        .selectFrom("payments.payment")
        .select(["id", "order_id", "amount", "currency", "status"])
        .where("provider", "=", PROVIDER)
        .where("provider_reference", "=", reference(token));
      if (lock) q = q.forUpdate();
      const p = await q.executeTakeFirst();
      if (p === undefined) return undefined;
      const failed = await trx
        .selectFrom("payments.payment_attempt")
        .select((eb) => eb.fn.countAll<string>().as("n"))
        .where("payment_id", "=", p.id)
        .where("status", "=", "failed")
        .executeTakeFirstOrThrow();
      const status: PaymentStatus =
        p.status === "captured" ? "captured" : p.status === "failed" ? "failed" : "pending";
      return {
        id: p.id,
        orderId: p.order_id,
        amount: Number(p.amount),
        currency: p.currency,
        status,
        declinedAttempts: Number(failed.n),
      };
    });
  }

  return {
    async createTestPayment({ orderId, amount, currency }) {
      const token = randomBytes(32).toString("base64url");
      await withTenantTransaction(db, async (trx) => {
        await trx
          .insertInto("payments.payment_method_config")
          .values({ tenant_id: tenant(), provider: PROVIDER, method_code: "test_card", name: "Testzahlung" })
          .onConflict((oc) => oc.columns(["tenant_id", "provider", "method_code"]).doNothing())
          .execute();
        const config = await trx
          .selectFrom("payments.payment_method_config")
          .select("id")
          .where("provider", "=", PROVIDER)
          .where("method_code", "=", "test_card")
          .executeTakeFirstOrThrow();
        await trx
          .insertInto("payments.payment")
          .values({
            tenant_id: tenant(),
            order_id: orderId,
            payment_method_config_id: config.id,
            provider: PROVIDER,
            provider_reference: reference(token),
            currency,
            amount,
          })
          .execute();
      });
      return { token };
    },

    findTestPayment: (token) => load(token, false),

    async completeTestPayment(token, outcome) {
      return withTenantTransaction(db, async (trx) => {
        const p = await load(token, true);
        if (p === undefined || p.status === "captured") return p;
        const attempts = await trx
          .selectFrom("payments.payment_attempt")
          .select((eb) => eb.fn.max("attempt_no").as("max"))
          .where("payment_id", "=", p.id)
          .executeTakeFirst();
        await trx
          .insertInto("payments.payment_attempt")
          .values({
            tenant_id: tenant(),
            payment_id: p.id,
            attempt_no: Number(attempts?.max ?? 0) + 1,
            status: outcome === "paid" ? "succeeded" : "failed",
            ...(outcome === "paid"
              ? {}
              : { failure_code: "declined", failure_message: "Testzahlung abgelehnt" }),
            completed_at: new Date(),
          })
          .execute();
        if (outcome === "paid")
          await trx
            .updateTable("payments.payment")
            .set({ status: "captured", captured_amount: p.amount })
            .where("id", "=", p.id)
            .execute();
        return load(token, false);
      });
    },
  };
}
