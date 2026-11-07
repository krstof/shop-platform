// EINZIGE öffentliche Datei des Moduls identity (Architektur 3.3, Regel 3).
// Better Auth, der Verbindungspool als shop_auth und alle Anmeldegeheimnisse bleiben im Modul.
export {
  createIdentityService,
  CLEAR_SESSION_COOKIE,
  type ActiveSession,
  type IdentityService,
  type IdentityServiceOptions,
  type NewUser,
  type SignInRequest,
  type SignInResult,
  type ConfirmTwoFactorSetupResult,
  type StartTwoFactorSetupResult,
  type TwoFactorSetup,
  type VerifySecondFactorResult,
} from "./internal/identity-service.js";
export {
  MAX_SECOND_FACTOR_FAILURES,
  PENDING_SECOND_FACTOR_SECONDS,
  SESSION_RULES,
  type SessionKind,
  type SessionRules,
} from "./internal/session-rules.js";
export type { AuthOptions as IdentityOptions } from "./internal/auth.js";
export { SESSION_COOKIE_NAME, SESSION_IDLE_SECONDS, SESSION_MAX_AGE_SECONDS } from "./internal/auth.js";
export {
  checkNewPassword,
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
  type PasswordProblem,
} from "./internal/password.js";
export {
  authEndpoints,
  currentSessionSchema,
  type AuthEndpointOptions,
  type ShopOfUser,
} from "./http/auth.js";
export {
  createMembershipDirectory,
  type Membership,
  type MembershipDirectory,
  type MembershipDirectoryOptions,
} from "./internal/memberships.js";
export {
  isSystemRole,
  MERCHANT_SCOPES,
  scopesForRole,
  SYSTEM_ROLES,
  type SystemRole,
} from "./internal/roles.js";
export {
  LOGIN_THROTTLE_RULES,
  LoginThrottle,
  loginNetwork,
  type LoginThrottleRules,
} from "./internal/login-throttle.js";
