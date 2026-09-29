import { createRequire } from 'node:module'

import { expect, it } from 'vitest'

import serverPlugin from '../app/plugins/analytics-events.server'

import type * as Vue from 'vue'

// Use the renderer paired with Nuxt's Vue instance in the installed consumer graph.
const loadNuxtDependency = createRequire(
  createRequire(import.meta.url).resolve('nuxt/package.json'),
)
const { createSSRApp } = loadNuxtDependency('vue') as typeof Vue
const { renderToString } = loadNuxtDependency('vue/server-renderer') as {
  renderToString: (app: ReturnType<typeof createSSRApp>) => Promise<string>
}

it('renders a tracked link on the server without a browser or analytics transport', async () => {
  const app = createSSRApp({
    template: `<a href="https://www.cloudflarestatus.com" v-track="{
      event: 'outbound_link_clicked',
      properties: { action_id: 'official_status', destination_host: 'www.cloudflarestatus.com' }
    }">Official status</a>`,
  })
  const plugin = serverPlugin as unknown as { setup: (runtime: { vueApp: typeof app }) => void }
  plugin.setup({ vueApp: app })
  expect(await renderToString(app)).toBe(
    '<a href="https://www.cloudflarestatus.com">Official status</a>',
  )
})
