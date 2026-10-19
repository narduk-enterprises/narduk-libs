import type { Nuxt } from '@nuxt/schema'

interface NitroConfigLike {
  ignore?: string[]
}

/** fast-glob treats these as pattern syntax; a path must match literally. */
function escapeGlob(path: string): string {
  return path.replaceAll(/[()[\]{}*?!]/gu, String.raw`\$&`)
}

/**
 * Keep the layer's `GET /api/health` out of Nitro's route scan
 * (narduk-libs#1940), so an app that already serves its own `/api/health`
 * (whatever file it lives in) is the only handler for it.
 *
 * Nitro scans every scan dir and keeps the FIRST handler it sees per route, so
 * the layer's file would shadow an app route declared under `server/routes/`
 * (scanned after `server/api/`). Dropping the file at scan time is the only
 * place that changes the outcome; filtering `scannedHandlers` afterwards would
 * have lost the app's route already. The pattern is the file's absolute path,
 * so an app file with the same relative name is never ignored.
 */
export function ignoreLayerHealthRoute(
  nuxt: Pick<Nuxt, 'hook'>,
  healthRouteFile: string,
  health?: boolean,
): void {
  if (health !== false) return
  // `nitro:config` is declared by nitropack's augmentation, which this file
  // does not load, so the hook name is typed by hand here.
  const hookNitro = nuxt.hook.bind(nuxt) as unknown as (
    name: 'nitro:config',
    handler: (config: NitroConfigLike) => void,
  ) => unknown
  hookNitro('nitro:config', (config) => {
    const pattern = escapeGlob(healthRouteFile)
    config.ignore ||= []
    if (!config.ignore.includes(pattern)) config.ignore.push(pattern)
  })
}
