/// <reference lib="dom" />
// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createSSRApp, defineComponent, h, onServerPrefetch, useId } from 'vue'
import { renderToString } from 'vue/server-renderer'

import { registerServerPrefetch } from '../runtime/app/server-prefetch'

/**
 * The stonx#1356 case, rendered for real: a layout registers a server prefetch and a component
 * under it renders `useId()`. The server renders to a string; a client app hydrates that markup.
 * A hook registered on the server alone makes the ids differ and Vue reports a hydration mismatch;
 * `registerServerPrefetch` (what `onHydrationSafeServerPrefetch` calls) keeps them equal.
 */
type Register = (work: () => unknown, isServer: boolean) => void

const serverOnly: Register = (work, isServer) => {
  if (isServer) onServerPrefetch(work)
}

const Field = defineComponent({
  setup() {
    const id = useId()
    return () => h('label', { for: id }, [h('input', { id })])
  },
})

function makeApp(register: Register, isServer: boolean, work: () => unknown) {
  const Layout = defineComponent({
    setup(_, { slots }) {
      register(work, isServer)
      return () => h('header', [h(Field), slots.default?.()])
    },
  })
  return createSSRApp({ render: () => h('main', [h(Layout, null, () => h(Field))]) })
}

async function renderThenHydrate(register: Register) {
  const work = vi.fn(async () => {})
  const html = await renderToString(makeApp(register, true, work))
  const serverIds = [...html.matchAll(/ id="([^"]+)"/g)].map((m) => m[1])

  document.body.innerHTML = `<div id="app">${html}</div>`
  const warnings: string[] = []
  const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
  const client = makeApp(register, false, work)
  client.config.warnHandler = (message) => warnings.push(message)
  client.mount('#app')
  const mismatch = errors.mock.calls.some((call) => String(call[0]).includes('mismatch'))
  errors.mockRestore()
  const clientIds = [...document.querySelectorAll('input')].map((input) => input.id)
  client.unmount()
  return { work, serverIds, clientIds, warnings, mismatch }
}

afterEach(() => {
  document.body.innerHTML = ''
})

describe('registerServerPrefetch (onHydrationSafeServerPrefetch)', () => {
  it('a server-only hook gives the server deeper ids, and hydration mismatches', async () => {
    const run = await renderThenHydrate(serverOnly)
    expect(run.work).toHaveBeenCalledTimes(1)
    expect(run.serverIds).toHaveLength(2)
    expect(run.warnings.some((w) => w.includes('mismatch'))).toBe(true)
  })

  it('a hook on both sides keeps every id, with no mismatch, and works only on the server', async () => {
    const run = await renderThenHydrate(registerServerPrefetch)
    expect(run.work).toHaveBeenCalledTimes(1)
    expect(run.serverIds).toHaveLength(2)
    expect(run.clientIds).toEqual(run.serverIds)
    expect(run.warnings).toEqual([])
    expect(run.mismatch).toBe(false)
  })
})
