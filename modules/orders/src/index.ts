// EINZIGE öffentliche Datei des Moduls orders (Architektur 3.3, Regel 3).
// MVP-Etappen M6 (Bestellung anlegen, bezahlt markieren) und M7 (Bestellungen im Backoffice).
import type { Database } from "@shop/kernel";
import type { ShopSettings } from "@shop/shop-settings";
import { orderRepository, type OrderRepository } from "./internal/orders.js";

export type {
  FulfillmentState,
  NewOrder,
  NewOrderLine,
  OrderAddress,
  OrderLineView,
  OrderStatus,
  OrderView,
  PaymentState,
} from "./internal/orders.js";
export { taxIncluded } from "./internal/orders.js";

export interface OrdersDependencies {
  /** Verbindung als Rolle shop_app. */
  readonly database: Database<unknown>;
  readonly settings: ShopSettings;
}

export type Orders = Pick<OrderRepository, "place" | "markPaid" | "view">;

export function createOrders(deps: OrdersDependencies): Orders {
  const repo = orderRepository(deps.database, deps.settings);
  return { place: repo.place, markPaid: repo.markPaid, view: repo.view };
}
