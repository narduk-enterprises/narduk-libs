import { defineNuxtPlugin, useHead, useRuntimeConfig } from '#imports'

import { runWhenBrowserIdle } from '../build-idle'
import { formatBuildTimeLocal } from '../utils/formatBuildTimeLocal'
import { readRuntimeConfigString } from '../utils/readRuntimeConfigString'

/**
 * Injects build metadata into the document head (SSR + client) so the active
 * deployment can be verified from page source, devtools, or curl.
 *
 * The server-rendered markers (`app-version`, `build-version`, `build-time`)
 * are unchanged. The client-only `build-time-local` tag is added once the app
 * has mounted and the browser is idle, so formatting it stays off the path to
 * hydration (narduk-libs#1380). `app:mounted` never fires on the server, so
 * SSR HTML never carries the tag.
 */
export default defineNuxtPlugin((nuxtApp) => {
  const config = useRuntimeConfig().public
  const appVersion = readRuntimeConfigString(config.appVersion)
  const buildVersion = readRuntimeConfigString(config.buildVersion, appVersion)
  const buildTime = readRuntimeConfigString(config.buildTime)

  // `useHead()` needs the Vue app's provide/inject context, not only Nuxt's async context.
  nuxtApp.vueApp.runWithContext(() => {
    useHead({
      meta: [
        { name: 'app-version', content: appVersion },
        { name: 'build-version', content: buildVersion },
        { name: 'build-time', content: buildTime },
      ],
    })
  })

  nuxtApp.hooks.hookOnce('app:mounted', () => {
    runWhenBrowserIdle(() => {
      const buildTimeLocal = formatBuildTimeLocal(buildTime)
      if (!buildTimeLocal) return

      nuxtApp.vueApp.runWithContext(() => {
        useHead({ meta: [{ name: 'build-time-local', content: buildTimeLocal }] })
      })
    })
  })
})
