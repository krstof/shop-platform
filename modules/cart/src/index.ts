// EINZIGE öffentliche Datei des Moduls cart (Architektur 3.3, Regel 3).
// MVP-Etappe M6: Warenkorb für Gäste. Erkannt wird er an einem Zufallswert (Token), den die
// Storefront im Cookie hält; in der Datenbank steht nur dessen SHA-256 (wie bei Sitzungen).
// Preise und Namen kommen erst beim Anzeigen aus dem Katalog, der Warenkorb merkt sich nur Mengen.
import { createHash, randomBytes } from "node:crypto";
import { getContext, withTenantTransaction, type Database } from "@shop/kernel";
import type { DB } from "./db.generated.js";

export interface CartDependencies {
  /** Verbindung als Rolle shop_app. */
  readonly database: Database<unknown>;
}

export interface CartLine {
  readonly variantId: string;
  readonly quantity: number;
}

export interface CartContent {
  readonly id: string;
  readonly lines: readonly CartLine[];
  /** Eingegebener Gutscheincode (Großbuchstaben) oder `null`. Ob er gilt, prüft der Checkout. */
  readonly couponCode: string | null;
}

export interface Carts {
  /** Neuer leerer Warenkorb; das Token gibt es nur hier im Klartext. */
  create(channelId: string): Promise<{ token: string; cart: CartContent }>;
  /** Aktiver Warenkorb zum Token; unbekannt, abgelaufen oder schon bestellt: `undefined`. */
  find(token: string): Promise<CartContent | undefined>;
  /** Menge einer Variante setzen; 0 entfernt sie. */
  setQuantity(cartId: string, variantId: string, quantity: number): Promise<void>;
  /** Gutscheincode merken (`null` entfernt ihn). Erwartet die normalisierte Form. */
  setCoupon(cartId: string, code: string | null): Promise<void>;
  /** Nach der Bestellung: Warenkorb ist verbraucht. */
  markConverted(cartId: string): Promise<void>;
}

/** Tokens sind 32 Byte Zufall in Base64url (43 Zeichen). */
export const CART_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

function hash(token: string): Buffer {
  return createHash("sha256").update(token).digest();
}

export function createCarts(deps: CartDependencies): Carts {
  const db = deps.database as Database<DB>;
  const tenant = () => getContext()?.tenantId ?? "";

  async function lines(cartId: string): Promise<CartLine[]> {
    return withTenantTransaction(db, async (trx) =>
      (
        await trx
          .selectFrom("cart.cart_line")
          .select(["variant_id", "quantity"])
          .where("cart_id", "=", cartId)
          .orderBy("position")
          .orderBy("id")
          .execute()
      ).map((l) => ({ variantId: l.variant_id, quantity: l.quantity })),
    );
  }

  return {
    async create(channelId) {
      const token = randomBytes(32).toString("base64url");
      const row = await withTenantTransaction(db, (trx) =>
        trx
          .insertInto("cart.cart")
          .values({ tenant_id: tenant(), token_hash: hash(token), channel_id: channelId })
          .returning("id")
          .executeTakeFirstOrThrow(),
      );
      return { token, cart: { id: row.id, lines: [], couponCode: null } };
    },

    async find(token) {
      if (!CART_TOKEN_PATTERN.test(token)) return undefined;
      const row = await withTenantTransaction(db, (trx) =>
        trx
          .selectFrom("cart.cart")
          .select(["id", "coupon_code"])
          .where("token_hash", "=", hash(token))
          .where("status", "=", "active")
          .where("expires_at", ">", new Date())
          .executeTakeFirst(),
      );
      if (row === undefined) return undefined;
      return { id: row.id, lines: await lines(row.id), couponCode: row.coupon_code };
    },

    async setQuantity(cartId, variantId, quantity) {
      if (!Number.isSafeInteger(quantity) || quantity < 0)
        throw new RangeError("Menge muss ganz und ≥ 0 sein");
      await withTenantTransaction(db, async (trx) => {
        if (quantity === 0) {
          await trx
            .deleteFrom("cart.cart_line")
            .where("cart_id", "=", cartId)
            .where("line_key", "=", variantId)
            .execute();
        } else {
          const count = await trx
            .selectFrom("cart.cart_line")
            .select((eb) => eb.fn.countAll<string>().as("n"))
            .where("cart_id", "=", cartId)
            .executeTakeFirstOrThrow();
          await trx
            .insertInto("cart.cart_line")
            .values({
              tenant_id: tenant(),
              cart_id: cartId,
              variant_id: variantId,
              line_key: variantId,
              quantity,
              position: Number(count.n),
            })
            .onConflict((oc) => oc.columns(["tenant_id", "cart_id", "line_key"]).doUpdateSet({ quantity }))
            .execute();
        }
        await trx
          .updateTable("cart.cart")
          .set({ last_activity_at: new Date(), expires_at: new Date(Date.now() + 30 * 24 * 3600_000) })
          .where("id", "=", cartId)
          .execute();
      });
    },

    async setCoupon(cartId, code) {
      await withTenantTransaction(db, (trx) =>
        trx
          .updateTable("cart.cart")
          .set({ coupon_code: code, last_activity_at: new Date() })
          .where("id", "=", cartId)
          .execute(),
      );
    },

    async markConverted(cartId) {
      await withTenantTransaction(db, (trx) =>
        trx.updateTable("cart.cart").set({ status: "converted" }).where("id", "=", cartId).execute(),
      );
    },
  };
}
