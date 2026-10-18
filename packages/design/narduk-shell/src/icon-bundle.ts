import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * The Lucide icons this package's own components name, as `lucide:<name>`.
 *
 * `@nuxt/icon` bundles into the client only the icons it is told about, and its
 * source scan reads Nuxt layers; this package is a module, so its sources are
 * never scanned. A component that renders `i-lucide-arrow-up-down` then asks
 * `/api/_nuxt_icon` for it while the page renders on the server, and a cold
 * worker waits out the module's 1500 ms timeout on the first page that has one
 * (operator-portal#2757, `NeSortHeader` on every sortable table). The module
 * hands this list to `icon:clientBundleIcons` so the icons ship in the bundle.
 *
 * A name no installed collection carries is skipped by `@nuxt/icon`, so the
 * pattern may over-match; it must never under-match what a template writes.
 */
const LUCIDE_NAME = /\b(?:i-)?lucide[:-]([a-z0-9]+(?:-[a-z0-9]+)*)\b/g
const SOURCE_FILE = /\.(?:vue|ts)$/

export function lucideIconsIn(dir: string, found = new Set<string>()): Set<string> {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) {
      if (entry.name !== 'node_modules') lucideIconsIn(path, found)
    } else if (SOURCE_FILE.test(entry.name) && !entry.name.endsWith('.d.ts')) {
      for (const [, name] of readFileSync(path, 'utf8').matchAll(LUCIDE_NAME)) {
        found.add(`lucide:${name}`)
      }
    }
  }
  return found
}
