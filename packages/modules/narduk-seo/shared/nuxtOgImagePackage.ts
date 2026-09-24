import { existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

export const NUXT_OG_IMAGE_PACKAGE = 'nuxt-og-image'

/**
 * Static-card apps omit this package so they do not inherit its
 * image-processing tree (narduk-libs#170). Runtime OG still needs the pin.
 */
export const MISSING_NUXT_OG_IMAGE_MESSAGE =
  '[@narduk-enterprises/narduk-seo] Runtime OG image generation requires the optional nuxt-og-image@6.8.0 peer. Add it to the app. Apps that only ship a static defaultOgImage should set ogImage.enabled: false or ogImage.zeroRuntime: true and omit the package so they do not inherit its image-processing tree.'

export function isRuntimeOgImageGenerationEnabled(ogImage: {
  enabled?: boolean
  zeroRuntime?: boolean
}): boolean {
  return ogImage.enabled !== false && ogImage.zeroRuntime !== true
}

/** `zeroRuntime` still needs the module: it only turns off the request-time renderer. */
export function isNuxtOgImageModuleRequested(ogImage: { enabled?: boolean }): boolean {
  return ogImage.enabled !== false
}

export function canResolveNuxtOgImage(
  probe: (id: string) => string = findNuxtOgImageManifest,
): boolean {
  try {
    probe(NUXT_OG_IMAGE_PACKAGE)
    return true
  } catch {
    return false
  }
}

function findNuxtOgImageManifest(): string {
  let dir = dirname(fileURLToPath(import.meta.url))
  for (;;) {
    const manifest = join(dir, 'node_modules', NUXT_OG_IMAGE_PACKAGE, 'package.json')
    if (existsSync(manifest)) return manifest
    const parent = dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  // Last resort: CJS resolve (fails when the package has no `require` export).
  createRequire(import.meta.url).resolve(NUXT_OG_IMAGE_PACKAGE)
  return NUXT_OG_IMAGE_PACKAGE
}
