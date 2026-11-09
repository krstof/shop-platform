// EINZIGE öffentliche Datei des Moduls identity (Architektur 3.3, Regel 3).
// Better Auth, der Verbindungspool als shop_auth und alle Anmeldegeheimnisse bleiben im Modul.
export {
  createIdentityService,
  CLEAR_SESSION_COOKIE,
  type ActiveSession,
  type IdentityService,
  type IdentityServiceOptions,
  type Invitee,
  type PendingInvitation,
  type NewUser,
  type SignInRequest,
  type SignInResult,
  type ConfirmPasswordResult,
  type ResetPasswordResult,
  type ConfirmTwoFactorSetupResult,
  type StartTwoFactorSetupResult,
  type TwoFactorSetup,
  type VerifySecondFactorResult,
} from "./internal/identity-service.js";
export {
  MAX_SECOND_FACTOR_FAILURES,
  PENDING_SECOND_FACTOR_SECONDS,
  REAUTHENTICATION_SECONDS,
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
  TOKEN_FORBIDDEN_SCOPES,
  TOKEN_SCOPES,
  type SystemRole,
} from "./internal/roles.js";
export {
  API_TOKEN_PATTERN,
  API_TOKEN_PREFIX,
  createApiTokenService,
  MAX_ACTIVE_TOKENS_PER_SHOP,
  type ApiTokenRecord,
  type ApiTokenService,
  type ApiTokenServiceOptions,
  type AuthenticatedApiToken,
} from "./internal/api-tokens.js";
export { apiTokenEndpoints, type ApiTokenEndpointOptions } from "./http/api-tokens.js";
export {
  apiTokenCreated,
  apiTokenRevoked,
  identityEvents,
  memberInvited,
  memberJoined,
  memberRemoved,
} from "./identity.events.js";
export {
  createMemberService,
  INVITABLE_ROLES,
  type AcceptResult,
  type InviteResult,
  type MemberRecord,
  type MemberService,
  type MemberServiceOptions,
  type RemoveResult,
} from "./internal/members.js";
export {
  INVITATION_PATH,
  INVITATION_SECONDS,
  MAX_PENDING_INVITATIONS_PER_SHOP,
} from "./internal/invitations.js";
export { memberEndpoints, type MemberEndpointOptions } from "./http/members.js";
export {
  LOGIN_THROTTLE_RULES,
  LoginThrottle,
  loginNetwork,
  type LoginThrottleRules,
} from "./internal/login-throttle.js";
export {
  PASSWORD_RESET_MAILS_PER_WINDOW,
  PASSWORD_RESET_PATH,
  PASSWORD_RESET_SECONDS,
  PASSWORD_RESET_WINDOW_SECONDS,
  ResetMailLimiter,
  type MailSender,
  type OutgoingMail,
} from "./internal/password-reset.js";
