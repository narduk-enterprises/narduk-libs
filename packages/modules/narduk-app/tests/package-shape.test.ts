import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), '..')

describe('narduk-app package shape', () => {
  it('keeps zod an optional peer so HTTP-only consumers are not warned', () => {
    const manifest = JSON.parse(readFileSync(join(packageRoot, 'package.json'), 'utf8')) as {
      peerDependencies?: Record<string, string>
      peerDependenciesMeta?: Record<string, { optional?: boolean }>
    }

    expect(manifest.peerDependencies?.zod).toBe('^4.4.3')
    expect(manifest.peerDependenciesMeta?.zod).toEqual({ optional: true })
  })
})
