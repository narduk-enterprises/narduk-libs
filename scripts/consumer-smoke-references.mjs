import { existsSync, statSync } from 'node:fs'
import { join } from 'node:path'

export const retiredReferencePattern = new RegExp(
  [
    'narduk-template',
    'narduk-nuxt-template',
    'narduk-fleet',
    'narduk-cli',
    'narduk-starter-toolkit',
    'narduk-nuxt-module',
    '\\.template-reference',
    '\\.template-version',
    'narduk\\.layout\\.json',
    'guardrail-exceptions\\.json',
    'scripts/narduk-toolchain\\.mjs',
    'provision\\.json',
    '#layer',
    '#server/(?:app|core)-orm-tables',
    'command\\.nard\\.uk',
    'CONTROL_PLANE_URL',
    '/api/control-plane',
    'templateManaged',
    'service-worker',
    'serviceWorker',
  ].join('|'),
  'i',
)

// These icons and the manifest are static brand assets, not a service worker.
// The generated build's `assets check` validates their contents; prove here
// that Nitro also copied every checked file into the deployable output.
export const requiredBrandAssets = [
  'favicon.ico',
  'favicon.svg',
  'favicon-32x32.png',
  'apple-touch-icon.png',
  'icon-192.png',
  'icon-512.png',
  'icon-mask.png',
  'site.webmanifest',
]

export function assertBuiltBrandAssets(publicDirectory) {
  for (const asset of requiredBrandAssets) {
    const path = join(publicDirectory, asset)
    if (!existsSync(path) || !statSync(path).isFile() || statSync(path).size === 0) {
      throw new Error(`Generated consumer is missing built brand asset ${asset}.`)
    }
  }
}
