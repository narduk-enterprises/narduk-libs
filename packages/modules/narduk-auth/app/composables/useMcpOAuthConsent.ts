import type { McpOAuthConsentState } from '../../shared/types/mcp-oauth'

/**
 * State and actions for an MCP OAuth consent page, so each app renders its
 * own. The page is client-only (`ssr: false`): it passes its query to the
 * server verbatim, sends a signed-out visitor to the app's login (returning
 * here afterwards), and follows only redirects the server validated.
 *
 * Every string in `state` that describes the client came from that client:
 * render it as text (`{{ }}`), never with `v-html`.
 */
export function useMcpOAuthConsent() {
  const config = useRuntimeConfig()
  const state = ref<McpOAuthConsentState | null>(null)
  const loading = ref(true)
  const busy = ref(false)
  const failure = ref('')

  const here = () =>
    import.meta.client ? `${window.location.pathname}${window.location.search}` : ''
  const loginPath = computed(() => {
    const login = String(config.public.authLoginPath || '/login')
    return `${login}?next=${encodeURIComponent(here())}`
  })

  async function load() {
    loading.value = true
    failure.value = ''
    try {
      const search = import.meta.client ? window.location.search : ''
      state.value = await $fetch<McpOAuthConsentState>(`/api/auth/mcp/consent${search}`, {
        headers: { 'X-Requested-With': 'XMLHttpRequest' },
      })
      if (state.value.status === 'login') await navigateTo(loginPath.value)
    } catch {
      state.value = { status: 'error', message: 'This sign-in request could not be loaded.' }
    } finally {
      loading.value = false
    }
  }

  async function decide(decision: 'approve' | 'deny') {
    if (state.value?.status !== 'consent' || busy.value) return
    busy.value = true
    failure.value = ''
    try {
      const result = await $fetch<{ redirectTo: string }>('/api/auth/mcp/consent', {
        method: 'POST',
        body: { handle: state.value.handle, decision },
        headers: { 'X-Requested-With': 'XMLHttpRequest' },
      })
      if (import.meta.client) window.location.assign(result.redirectTo)
    } catch (error) {
      const message = (error as { data?: { message?: string; statusMessage?: string } }).data
      failure.value =
        message?.statusMessage ||
        message?.message ||
        'Something went wrong. Start again from the app.'
      busy.value = false
    }
  }

  /** Send the user back to the client with the error, when the server validated where to. */
  function returnToClient() {
    if (state.value?.status === 'error' && state.value.redirectTo && import.meta.client) {
      window.location.assign(state.value.redirectTo)
    }
  }

  onMounted(load)

  return {
    state,
    loading,
    busy,
    failure,
    loginPath,
    approve: () => decide('approve'),
    deny: () => decide('deny'),
    returnToClient,
    reload: load,
  }
}
