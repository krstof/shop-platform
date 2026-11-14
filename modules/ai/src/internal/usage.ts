// Verbrauch je Shop und Tag (Tabelle ai.usage_day). Ein Tageslimit begrenzt die Kosten des
// Sprachmodells: Ist es erreicht, antwortet der Assistent erst am nächsten Tag wieder.
import { getContext, withTenantTransaction, type Database } from "@shop/kernel";
import type { DB } from "../db.generated.js";

/** Heutiger Tag in UTC (YYYY-MM-DD). */
export function today(now = new Date()): string {
  return now.toISOString().slice(0, 10);
}

export function usageRepository(db: Database<DB>) {
  return {
    /** Anfragen des aktuellen Shops heute. */
    async requestsToday(): Promise<number> {
      return withTenantTransaction(db, async (trx) => {
        const row = await trx
          .selectFrom("ai.usage_day")
          .select("requests")
          .where((eb) => eb("day", "=", eb.cast<Date>(eb.val(today()), "date")))
          .executeTakeFirst();
        return row?.requests ?? 0;
      });
    },

    /** Eine Anfrage mit ihrem Verbrauch zählen. */
    async record(inputTokens: number, outputTokens: number): Promise<void> {
      await withTenantTransaction(db, async (trx) => {
        await trx
          .insertInto("ai.usage_day")
          .values({
            tenant_id: getContext()?.tenantId ?? "",
            day: today(),
            requests: 1,
            input_tokens: inputTokens,
            output_tokens: outputTokens,
          })
          .onConflict((oc) =>
            oc.columns(["tenant_id", "day"]).doUpdateSet((eb) => ({
              requests: eb("ai.usage_day.requests", "+", 1),
              input_tokens: eb("ai.usage_day.input_tokens", "+", inputTokens),
              output_tokens: eb("ai.usage_day.output_tokens", "+", outputTokens),
            })),
          )
          .execute();
      });
    },
  };
}

export type UsageRepository = ReturnType<typeof usageRepository>;
