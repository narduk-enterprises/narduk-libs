import { fileURLToPath } from 'node:url'

import { registerAuthSessionRefreshTests } from '../../../src/server/kit/auth-session-refresh'

const SESSION_USER_STUB = fileURLToPath(
  new URL('./__fixtures__/session-user-stub.ts', import.meta.url),
)

registerAuthSessionRefreshTests(
  async () => {
    const stub = (await import(SESSION_USER_STUB)) as {
      useRefreshedSessionUser: (event: { path: string }) => Promise<unknown>
    }

    const handler = async (event: { path: string }) => {
      const path = event.path
      if (!path.startsWith('/api/admin/') && path !== '/api/auth/me') return
      await stub.useRefreshedSessionUser(event)
    }

    return { default: handler }
  },
  { sessionUserModuleId: SESSION_USER_STUB },
)
