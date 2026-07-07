import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

const __dirname = dirname(fileURLToPath(import.meta.url))
const packageRoot = join(__dirname, '..')

describe('narduk-analytics package exports', () => {
  it('exports the module and analytics runtime surface', () => {
    const packageJson = JSON.parse(readFileSync(join(packageRoot, 'package.json'), 'utf-8')) as {
      exports: Record<string, unknown>
    }

    expect(packageJson.exports['./nuxt']).toEqual({
      import: './src/module.ts',
    })
    expect(packageJson.exports['./app/plugins/*']).toEqual({
      import: './app/plugins/*.ts',
    })
  })
})
