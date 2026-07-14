import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

const __dirname = dirname(fileURLToPath(import.meta.url))
const packageRoot = join(__dirname, '..')

describe('narduk-core package exports', () => {
  it('exports server runtime files for package-owned reuse', async () => {
    const packageJson = JSON.parse(readFileSync(join(packageRoot, 'package.json'), 'utf-8')) as {
      exports: Record<string, unknown>
    }

    expect(packageJson.exports['./server/*']).toEqual({
      import: './runtime/server/*.ts',
    })
  })

  it('exports app composables for package-owned UI state reuse', async () => {
    const packageJson = JSON.parse(readFileSync(join(packageRoot, 'package.json'), 'utf-8')) as {
      exports: Record<string, unknown>
    }

    expect(packageJson.exports['./app/composables/*']).toEqual({
      import: './runtime/app/composables/*.ts',
    })
  })

  it('exports core eslint fragments for follow-on package migration', async () => {
    const packageJson = JSON.parse(readFileSync(join(packageRoot, 'package.json'), 'utf-8')) as {
      exports: Record<string, unknown>
    }

    expect(packageJson.exports['./eslint-capability-packs']).toEqual({
      import: './eslint-capability-packs.mjs',
    })
  })

  it('does not ship retired PWA or control-plane runtime assets', () => {
    expect(existsSync(join(packageRoot, 'runtime/public/site.webmanifest'))).toBe(false)
    expect(existsSync(join(packageRoot, 'runtime/public/pwa-192x192.png'))).toBe(false)
    expect(existsSync(join(packageRoot, 'runtime/public/pwa-512x512.png'))).toBe(false)
    expect(existsSync(join(packageRoot, 'runtime/shared/controlPlaneProxy.ts'))).toBe(false)
    expect(existsSync(join(packageRoot, 'runtime/server/api/control-plane/[...path].ts'))).toBe(
      false,
    )
  })
})
