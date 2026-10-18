import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import { lucideIconsIn } from '../src/nuxt-icon-module'

describe('lucideIconsIn (operator-portal#2757)', () => {
  it('finds class, attribute and prefixed spellings in .vue and .ts, and skips node_modules and .d.ts', () => {
    const dir = mkdtempSync(join(tmpdir(), 'core-icons-'))
    mkdirSync(join(dir, 'components'))
    mkdirSync(join(dir, 'node_modules'))
    writeFileSync(
      join(dir, 'components', 'A.vue'),
      '<UIcon name="i-lucide-log-out" /><i class="i-lucide-x" />',
    )
    writeFileSync(join(dir, 'b.ts'), "export const glyph = 'lucide:layout-dashboard'")
    writeFileSync(join(dir, 'c.d.ts'), "type T = 'lucide:ignored-declaration'")
    writeFileSync(join(dir, 'node_modules', 'd.ts'), "export const d = 'lucide:ignored-dependency'")
    expect([...lucideIconsIn(dir)].sort()).toEqual([
      'lucide:layout-dashboard',
      'lucide:log-out',
      'lucide:x',
    ])
  })

  it("covers the icons of this package's own runtime", () => {
    const icons = lucideIconsIn(join(dirname(fileURLToPath(import.meta.url)), '..', 'runtime'))
    expect(icons.has('lucide:log-out')).toBe(true)
    expect(icons.has('lucide:check')).toBe(true)
  })
})
