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

  it('pins Nuxt 4 for both the nuxt and @nuxt/schema peers', () => {
    const packageJson = JSON.parse(readFileSync(join(packageRoot, 'package.json'), 'utf-8')) as {
      peerDependencies: Record<string, string>
    }

    expect(packageJson.peerDependencies.nuxt).toBe('>=4.0.0')
    expect(packageJson.peerDependencies['@nuxt/schema']).toBe('>=4.0.0')
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

  it('declares explicit runtime imports for packed color-mode UI', () => {
    const source = readFileSync(
      join(packageRoot, 'runtime/app/composables/useColorModeToggle.ts'),
      'utf-8',
    )

    expect(source).toContain("import { computed, onMounted, ref } from 'vue'")
    expect(source).toContain("import { useColorMode } from '#imports'")
  })

  it('does not ship retired PWA, shared icon, or control-plane runtime assets', () => {
    expect(existsSync(join(packageRoot, 'runtime/public/apple-touch-icon.png'))).toBe(false)
    expect(existsSync(join(packageRoot, 'runtime/public/favicon-16x16.png'))).toBe(false)
    expect(existsSync(join(packageRoot, 'runtime/public/favicon-32x32.png'))).toBe(false)
    expect(existsSync(join(packageRoot, 'runtime/public/favicon.ico'))).toBe(false)
    expect(existsSync(join(packageRoot, 'runtime/public/favicon.svg'))).toBe(false)
    expect(existsSync(join(packageRoot, 'runtime/public/site.webmanifest'))).toBe(false)
    expect(existsSync(join(packageRoot, 'runtime/public/pwa-192x192.png'))).toBe(false)
    expect(existsSync(join(packageRoot, 'runtime/public/pwa-512x512.png'))).toBe(false)
    expect(existsSync(join(packageRoot, 'runtime/shared/controlPlaneProxy.ts'))).toBe(false)
    expect(existsSync(join(packageRoot, 'runtime/server/api/control-plane/[...path].ts'))).toBe(
      false,
    )
  })
})
