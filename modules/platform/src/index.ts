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
export {
  createOperatorDirectory,
  OPERATOR_ROLES,
  type Operator,
  type OperatorDirectory,
  type OperatorDirectoryOptions,
  type OperatorRole,
} from "./internal/operators.js";
export {
  createShopAdministration,
  SHOP_HANDLE_PATTERN,
  type ChangeStatusResult,
  type CreateShopResult,
  type ShopAdministration,
  type ShopAdministrationOptions,
  type ShopRecord,
} from "./internal/shop-admin.js";
export {
  platformEndpoints,
  type OwnerInvitationResult,
  type PlatformEndpointOptions,
} from "./http/platform.js";
export { storeShopEndpoints } from "./http/store.js";
