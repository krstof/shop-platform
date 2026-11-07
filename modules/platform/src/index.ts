// EINZIGE öffentliche Datei des Moduls platform (Architektur 3.3, Regel 3).
export {
  createShopDirectory,
  MAX_SHOPS_PER_LOOKUP,
  TENANT_STATUSES,
  type ShopDirectory,
  type ShopDirectoryOptions,
  type ShopSummary,
  type TenantStatus,
} from "./internal/shops.js";
