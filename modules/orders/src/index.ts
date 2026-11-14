// EINZIGE öffentliche Datei des Moduls orders (Architektur 3.3, Regel 3).
// MVP-Etappen M6 (Bestellung anlegen, bezahlt markieren) und M7 (Bestellungen im Backoffice).
import type { Endpoint } from "@shop/http";
import type { Database } from "@shop/kernel";
import type { ShopSettings } from "@shop/shop-settings";
import { orderAdminEndpoints, type Restock } from "./http/admin.js";
import { orderRepository, type OrderRepository } from "./internal/orders.js";

export type {
  FulfillmentState,
  NewOrder,
  NewOrderLine,
  OrderAddress,
  OrderLineView,
  OrderStatus,
  OrderSummary,
  OrderView,
  PaymentState,
} from "./internal/orders.js";
export { allocateDiscount, shippingRateBp, taxIncluded } from "./internal/orders.js";

export interface OrdersDependencies {
  /** Verbindung als Rolle shop_app. */
  readonly database: Database<unknown>;
  readonly settings: ShopSettings;
  /** Ware stornierter Bestellungen zurücklegen (Modul inventory). Ohne Angabe: nichts zurücklegen. */
  readonly restock?: Restock | undefined;
}

export type Orders = Pick<OrderRepository, "place" | "markPaid" | "view">;

export function createOrders(deps: OrdersDependencies): Orders {
  const repo = orderRepository(deps.database, deps.settings);
  return { place: repo.place, markPaid: repo.markPaid, view: repo.view };
}

/** Endpunkte für das Backoffice (M7). */
export function orderEndpoints(deps: OrdersDependencies): Endpoint[] {
  return orderAdminEndpoints(orderRepository(deps.database, deps.settings), deps.restock);
}
