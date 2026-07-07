/**
 * Guest-only middleware — redirects authenticated users to the post-login path.
 *
 * Revalidates the session against the server so that stale or invalid cookies
 * are cleared before deciding whether to redirect. Without this, a user with
 * an expired session cookie would be bounced away from /login and never see it.
 *
 * Apply to pages that should only be visible to unauthenticated users
 * (login, register, index landing). Redirect path comes from app.config.auth.redirectPath.
 */
export default defineNuxtRouteMiddleware(async () => {
  const { loggedIn, fetch: refreshSession, clear } = useUserSession()

  try {
    await refreshSession()
  } catch {
    await clear()
  }

  if (loggedIn.value) {
    const appConfig = useAppConfig()
    const redirectPath =
      (appConfig as { auth?: { redirectPath?: string } }).auth?.redirectPath ?? '/dashboard/'
    return navigateTo(redirectPath, { replace: true })
  }
})
