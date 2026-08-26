export type {
  AppAuthProvider,
  AppSessionUser,
  AuthMutationResult,
  MfaEnrollmentResult,
} from '#narduk-auth-server/lib/app-auth/types'

export { ensureLinkedLocalUser } from '#narduk-auth-server/lib/app-auth/linking'
export {
  getCurrentSessionUser,
  getCurrentSupabaseContext,
  getSessionUserResponse,
} from '#narduk-auth-server/lib/app-auth/session'
export {
  loginUser,
  registerUser,
  startOAuthFlow,
  signInWithNativeApple,
  exchangeSupabaseCode,
  requestPasswordReset,
  logoutUser,
  deleteSupabaseAuthUser,
  getAuthUiState,
} from '#narduk-auth-server/lib/app-auth/auth-flows'
export { completeLocalEmailPassword } from '#narduk-auth-server/lib/app-auth/local-email-flow'
export {
  updateProfile,
  changePassword,
  enrollMfa,
  verifyMfa,
} from '#narduk-auth-server/lib/app-auth/profile'
