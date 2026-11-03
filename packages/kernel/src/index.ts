// Öffentliche Schnittstelle des Kernels (Architektur 3.2). Der Kernel kennt kein Fachmodul.
export * from "./rounding.js";
export * from "./money.js";
export * from "./tax.js";
export * from "./id.js";
export * from "./problem.js";
export * from "./locale.js";
export { PROBLEM_TITLES } from "./problem-texts.js";
export * from "./context.js";
export * from "./config.js";
export * from "./ip.js";
export * from "./logger.js";
export {
  connectDatabase,
  withTenantTransaction,
  withPlatformTransaction,
  MissingTenantError,
  type Database,
  type DatabaseOptions,
  type TenantTransactionOptions,
  type Transaction,
} from "./db/database.js";
export {
  abandonIdempotent,
  beginIdempotent,
  completeIdempotent,
  IDEMPOTENCY_KEY_PATTERN,
  IdempotencyInProgressError,
  IdempotencyKeyReusedError,
  requestFingerprint,
  type IdempotencyRequest,
  type IdempotencyStart,
} from "./db/idempotency.js";
