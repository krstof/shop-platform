// EINZIGE öffentliche Datei des Moduls identity (Architektur 3.3, Regel 3).
// Better Auth, der Verbindungspool als shop_auth und alle Anmeldegeheimnisse bleiben im Modul.
export {
  createIdentityService,
  CLEAR_SESSION_COOKIE,
  type ActiveSession,
  type IdentityService,
  type NewUser,
  type SignInRequest,
  type SignInResult,
} from "./internal/identity-service.js";
export type { AuthOptions as IdentityOptions } from "./internal/auth.js";
export { SESSION_COOKIE_NAME, SESSION_IDLE_SECONDS, SESSION_MAX_AGE_SECONDS } from "./internal/auth.js";
export {
  checkNewPassword,
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
  type PasswordProblem,
} from "./internal/password.js";
