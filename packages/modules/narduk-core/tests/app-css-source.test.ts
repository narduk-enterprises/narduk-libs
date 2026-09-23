import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

/**
 * Tailwind v4 skips node_modules when it detects sources, and a consuming app
 * installs narduk-core there. Without an explicit `@source`, a utility used
 * only by a core component is never generated: LayerAppHeader's desktop nav is
 * `hidden md:flex`, so in 2.13.0 it stayed `display: none` at every width.
 */
const CSS_PATH = fileURLToPath(new URL('../runtime/app/assets/css/main.css', import.meta.url))
const APP_DIR = fileURLToPath(new URL('../runtime/app', import.meta.url))

describe('narduk-core main.css sources', () => {
  it("scans core's own runtime/app for utilities", () => {
    const css = readFileSync(CSS_PATH, 'utf8').replaceAll(/\/\*[\s\S]*?\*\//g, '')
    const sources = [...css.matchAll(/@source\s+(['"])(.+?)\1\s*;/g)].map((match) =>
      resolve(dirname(CSS_PATH), match[2]!),
    )
    expect(sources).toContain(APP_DIR)
  })
})
