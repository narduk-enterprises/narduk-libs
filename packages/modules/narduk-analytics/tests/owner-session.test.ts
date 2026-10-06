import { beforeEach, describe, expect, it, vi } from 'vitest'

/** Enough of Vue for a ready session: `immediate` watches fire once, synchronously. */
function ref<T>(value: T): { value: T } {
  return { value }
}
function watch<T>(source: () => T, callback: (value: T) => void): () => void {
  callback(source())
  return () => {}
}

const session = {
  loggedIn: ref(false),
  ready: ref(true),
  user: ref<{ isAdmin?: boolean | null } | null>(null),
}

vi.mock('#imports', () => ({
  defineNuxtPlugin: <T>(definition: T): T => definition,
  useUserSession: () => session,
  watch,
}))

beforeEach(() => {
  vi.resetModules()
})

async function classify(loggedIn: boolean, isAdmin: boolean | null) {
  session.loggedIn.value = loggedIn
  session.user.value = loggedIn ? { isAdmin } : null
  const browser = await import('../app/traffic/trafficClassBrowser')
  const plugin = (await import('../app/plugins/analytics-owner-session.client')).default as {
    setup: () => void
  }
  plugin.setup()
  return browser.pageTrafficProperties()
}

describe('analytics-owner-session plugin', () => {
  it('tags a signed-in admin as owner by authenticated session', async () => {
    expect(await classify(true, true)).toMatchObject({
      traffic_class: 'owner',
      traffic_evidence: 'authenticated_session',
    })
  })

  it('leaves other signed-in users and anonymous visitors unmarked', async () => {
    expect(await classify(true, false)).toMatchObject({ traffic_class: 'unmarked' })
    expect(await classify(true, null)).toMatchObject({ traffic_class: 'unmarked' })
    expect(await classify(false, null)).toMatchObject({ traffic_class: 'unmarked' })
  })
})
