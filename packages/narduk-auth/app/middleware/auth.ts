/**
 * Auth middleware — redirects unauthenticated users to login.
 *
 * Revalidates the session against the server on every navigation so that
 * stale or invalid cookies are detected and cleared instead of granting
 * access to protected routes.
 *
 * Usage: `definePageMeta({ middleware: ['auth'] })`
 */
export default defineNuxtRouteMiddleware(async () => {
  const { loggedIn, fetch: refreshSession, clear } = useUserSession()

  try {
    await refreshSession()
  } catch {
    await clear()
  }

  if (!loggedIn.value) {
    return navigateTo('/login')
  }
})
