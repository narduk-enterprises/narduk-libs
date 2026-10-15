import { defineNuxtPlugin, useAppConfig, useRouter } from '#imports'

import {
  type ChunkReloadEnvironment,
  type ChunkReloadStorage,
  isChunkLoadError,
  isChunkReloadEnabled,
  reloadForChunkError,
} from '../../shared/chunk-reload'

function readSessionStorage(): ChunkReloadStorage | null {
  try {
    return window.sessionStorage
  } catch {
    return null
  }
}

/**
 * Recovers a tab that survived a deploy. The previous build's hashed chunks
 * are gone, so the next navigation fails with "Importing a module script
 * failed" (Safari), "Failed to fetch dynamically imported module" (Chrome) or
 * "error loading dynamically imported module" (Firefox). One hard reload to
 * the page being opened fetches the new build; `chunk-reload.ts` holds the
 * 10 second guard that keeps a genuinely broken deploy from looping.
 *
 * Opt out with `appConfig.narduk.chunkReload = false`.
 */
export default defineNuxtPlugin({
  name: 'narduk-chunk-reload',
  setup(nuxtApp) {
    if (!isChunkReloadEnabled(useAppConfig())) return

    const router = useRouter()
    const env: ChunkReloadEnvironment = {
      now: () => Date.now(),
      reload: (url) => {
        if (new URL(url, window.location.href).href === window.location.href) {
          window.location.reload()
        } else {
          window.location.assign(url)
        }
      },
      storage: readSessionStorage(),
    }

    // The page being opened, so the reload lands where the user was going
    // instead of on the page they were leaving.
    let pendingPath: string | undefined
    router.beforeEach((to) => {
      pendingPath = to.fullPath
    })
    router.afterEach(() => {
      pendingPath = undefined
    })

    const targetUrl = (path = pendingPath): string =>
      path ? router.resolve(path).href : window.location.href

    // Vite fires this for every failed preload; preventDefault() keeps it from
    // being rethrown, which is only right once a reload is underway.
    window.addEventListener('vite:preloadError', (event) => {
      if (reloadForChunkError(env, targetUrl())) event.preventDefault()
    })

    nuxtApp.hook('app:chunkError', () => {
      reloadForChunkError(env, targetUrl())
    })

    // A route component's chunk failing reaches the router with its target.
    router.onError((error, to) => {
      if (isChunkLoadError(error)) reloadForChunkError(env, targetUrl(to.fullPath))
    })
  },
})
