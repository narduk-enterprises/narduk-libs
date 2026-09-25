import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { afterEach, describe, expect, it } from 'vitest'

import * as stub from '../../../src/server/kit/nitro-runtime-stub.js'
import {
  type VitestAlias,
  nitroRuntimeStubPath,
  nuxtVitestAliases,
} from '../../../src/server/kit/vitest.js'

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), '../../..')
const scratch: string[] = []

afterEach(() => {
  for (const dir of scratch.splice(0)) rmSync(dir, { force: true, recursive: true })
  stub.resetTestRuntimeConfig()
})

/** A `.nuxt/tsconfig.json` shaped like the one Nuxt 4 + narduk-core write. */
const NUXT_PATHS: Record<string, string[]> = {
  '@unhead/vue': ['../node_modules/@unhead/vue'],
  h3: ['../node_modules/h3'],
  'nitropack/runtime': ['../node_modules/nitropack/runtime'],
  '~': ['../app'],
  '~/*': ['../app/*'],
  '@': ['../app'],
  '@/*': ['../app/*'],
  '~~': ['..'],
  '~~/*': ['../*'],
  '#shared': ['../shared'],
  '#shared/*': ['../shared/*'],
  '#server': ['../server'],
  '#server/*': ['../server/*'],
  '#layer': ['../core/runtime'],
  '#layer/*': ['../core/runtime/*'],
  '#narduk-core/schema': ['../core/runtime/server/database/pg-schema.ts'],
  '#narduk-core/postgres-runtime': ['../core/runtime/server/internal/postgres-runtime.ts'],
  '#narduk-db': ['../server/database/schema.ts'],
  '#imports': ['./imports'],
  '#app': ['../node_modules/nuxt/dist/app'],
  '#app/*': ['../node_modules/nuxt/dist/app/*'],
  '#app/types': ['../node_modules/nuxt/dist/app/types'],
}

function appRoot(paths: Record<string, string[]> | null = NUXT_PATHS, extra = {}): string {
  const root = mkdtempSync(join(tmpdir(), 'narduk-nuxt-aliases-'))
  scratch.push(root)
  if (paths !== null) {
    mkdirSync(join(root, '.nuxt'))
    writeFileSync(
      join(root, '.nuxt/tsconfig.json'),
      JSON.stringify({ compilerOptions: { paths, ...extra } }),
    )
  }
  return root
}

/** @rollup/plugin-alias semantics, which Vite uses: the first matching entry wins. */
function resolveAlias(aliases: readonly VitestAlias[], id: string): string | undefined {
  for (const { find, replacement } of aliases) {
    if (typeof find === 'string') {
      if (id === find || id.startsWith(`${find}/`)) return replacement + id.slice(find.length)
    } else if (find.test(id)) {
      return id.replace(find, replacement)
    }
  }
  return undefined
}

describe('nuxtVitestAliases', () => {
  it("resolves narduk-core's aliases to wherever module.ts pointed them (postgres schema here)", () => {
    const root = appRoot()
    const aliases = nuxtVitestAliases({ appRoot: root })
    expect(resolveAlias(aliases, '#narduk-core/schema')).toBe(
      join(root, 'core/runtime/server/database/pg-schema.ts'),
    )
    expect(resolveAlias(aliases, '#narduk-core/postgres-runtime')).toBe(
      join(root, 'core/runtime/server/internal/postgres-runtime.ts'),
    )
    expect(resolveAlias(aliases, '#narduk-db')).toBe(join(root, 'server/database/schema.ts'))
  })

  it('maps #layer as a prefix, not one file (narduk-nvr drift)', () => {
    const root = appRoot()
    const aliases = nuxtVitestAliases({ appRoot: root })
    expect(resolveAlias(aliases, '#layer/server/utils/database')).toBe(
      `${join(root, 'core/runtime')}/server/utils/database`,
    )
    expect(resolveAlias(aliases, '#layer/server/database/schema')).toBe(
      `${join(root, 'core/runtime')}/server/database/schema`,
    )
    expect(resolveAlias(aliases, '#layer')).toBe(join(root, 'core/runtime'))
  })

  it('maps #server, #shared, ~ and ~~ exactly and as prefixes', () => {
    const root = appRoot()
    const aliases = nuxtVitestAliases({ appRoot: root })
    expect(resolveAlias(aliases, '#server/utils/x')).toBe(`${join(root, 'server')}/utils/x`)
    expect(resolveAlias(aliases, '#shared/types')).toBe(`${join(root, 'shared')}/types`)
    expect(resolveAlias(aliases, '~/utils/map')).toBe(`${join(root, 'app')}/utils/map`)
    expect(resolveAlias(aliases, '~~/server/x')).toBe(`${root}/server/x`)
    expect(resolveAlias(aliases, '~')).toBe(join(root, 'app'))
  })

  it('puts the most specific key first so #app/types beats #app/*', () => {
    const root = appRoot()
    const aliases = nuxtVitestAliases({ appRoot: root })
    expect(resolveAlias(aliases, '#app/types')).toBe(join(root, 'node_modules/nuxt/dist/app/types'))
    expect(resolveAlias(aliases, '#app/composables/x')).toBe(
      `${join(root, 'node_modules/nuxt/dist/app')}/composables/x`,
    )
  })

  it('never aliases a bare package name, and leaves @-aliases out by default', () => {
    const aliases = nuxtVitestAliases({ appRoot: appRoot() })
    expect(resolveAlias(aliases, 'h3')).toBeUndefined()
    expect(resolveAlias(aliases, '@unhead/vue')).toBeUndefined()
    expect(resolveAlias(aliases, '@/components/x')).toBeUndefined()
  })

  it('takes extra namespaces but still refuses scoped packages under @', () => {
    const aliases = nuxtVitestAliases({ appRoot: appRoot(), namespaces: ['#', '~', '@'] })
    expect(resolveAlias(aliases, '@/components/x')).toMatch(/app\/components\/x$/)
    expect(resolveAlias(aliases, '@unhead/vue')).toBeUndefined()
    expect(() => nuxtVitestAliases({ appRoot: appRoot(), namespaces: ['nitropack'] })).toThrow(
      /bare package/,
    )
  })

  it('stubs #imports and nitropack/runtime with one shared module; the runtime match is anchored', () => {
    const aliases = nuxtVitestAliases({ appRoot: appRoot() })
    const stubPath = nitroRuntimeStubPath()
    expect(resolveAlias(aliases, '#imports')).toBe(stubPath)
    expect(resolveAlias(aliases, 'nitropack/runtime')).toBe(stubPath)
    expect(resolveAlias(aliases, 'nitropack/runtime/internal/app')).toBeUndefined()
  })

  it('leaves the stubs out when asked, keeping Nuxt’s own #imports target', () => {
    const root = appRoot()
    const aliases = nuxtVitestAliases({
      appRoot: root,
      stubs: { imports: false, nitroRuntime: false },
    })
    expect(resolveAlias(aliases, '#imports')).toBe(join(root, '.nuxt/imports'))
    expect(resolveAlias(aliases, 'nitropack/runtime')).toBeUndefined()
  })

  it('honours a baseUrl in the generated tsconfig', () => {
    const root = appRoot({ '#server/*': ['./server/*'] }, { baseUrl: '..' })
    const aliases = nuxtVitestAliases({ appRoot: root })
    expect(resolveAlias(aliases, '#server/a')).toBe(`${join(root, 'server')}/a`)
  })

  it('reads a custom tsconfig path', () => {
    const root = appRoot()
    writeFileSync(
      join(root, '.nuxt/tsconfig.server.json'),
      JSON.stringify({ compilerOptions: { paths: { '#internal/nuxt/paths': ['./paths'] } } }),
    )
    const aliases = nuxtVitestAliases({ appRoot: root, tsconfig: '.nuxt/tsconfig.server.json' })
    expect(resolveAlias(aliases, '#internal/nuxt/paths')).toBe(join(root, '.nuxt/paths'))
  })

  it('names nuxt prepare when .nuxt/tsconfig.json is missing', () => {
    expect(() => nuxtVitestAliases({ appRoot: appRoot(null) })).toThrow(/nuxt prepare/)
  })
})

describe('nitro-runtime-stub', () => {
  it('answers {} until a test sets a config, and resets', () => {
    expect(stub.useRuntimeConfig()).toEqual({})
    stub.setTestRuntimeConfig({ public: { siteUrl: 'https://x.test' } })
    expect(stub.useRuntimeConfig()).toEqual({ public: { siteUrl: 'https://x.test' } })
    stub.resetTestRuntimeConfig()
    expect(stub.useRuntimeConfig()).toEqual({})
  })

  it('has no request context', () => {
    expect(() => stub.useEvent()).toThrow(/request context/)
  })

  it('is the file nuxtVitestAliases points at', () => {
    expect(nitroRuntimeStubPath()).toBe(join(packageRoot, 'src/server/kit/nitro-runtime-stub.ts'))
  })
})

describe('nuxtVitestAliases under a real Vitest run', () => {
  it('resolves app code through the aliases and shares one runtime config across #imports and nitropack/runtime', () => {
    const root = appRoot()
    const write = (relative: string, contents: string) => {
      mkdirSync(dirname(join(root, relative)), { recursive: true })
      writeFileSync(join(root, relative), contents)
    }
    write('core/runtime/server/utils/site.ts', "export const coreName = 'core'\n")
    write('shared/names.ts', "export const sharedName = 'shared'\n")
    write(
      'server/utils/read-config.ts',
      [
        "import { useRuntimeConfig } from '#imports'",
        "import { useRuntimeConfig as nitroConfig } from 'nitropack/runtime'",
        "import { coreName } from '#layer/server/utils/site'",
        "import { sharedName } from '#shared/names'",
        'export const read = () => [useRuntimeConfig(), nitroConfig(), coreName, sharedName]',
        '',
      ].join('\n'),
    )
    write(
      'tests/read.test.ts',
      [
        "import { setTestRuntimeConfig } from 'nitropack/runtime'",
        "import { read } from '#server/utils/read-config'",
        "test('aliases', () => {",
        '  setTestRuntimeConfig({ answer: 42 })',
        "  expect(read()).toEqual([{ answer: 42 }, { answer: 42 }, 'core', 'shared'])",
        '})',
        '',
      ].join('\n'),
    )
    write(
      'vitest.config.mts',
      [
        `import { nuxtVitestAliases } from ${JSON.stringify(join(packageRoot, 'src/server/kit/vitest.ts'))}`,
        'export default {',
        '  resolve: { alias: nuxtVitestAliases({ appRoot: import.meta.dirname }) },',
        "  test: { globals: true, include: ['tests/**/*.test.ts'] },",
        '}',
        '',
      ].join('\n'),
    )

    const vitestCli = join(
      dirname(createRequire(import.meta.url).resolve('vitest/package.json')),
      'vitest.mjs',
    )
    const result = spawnSync(
      process.execPath,
      [vitestCli, 'run', '--root', root, '--config', join(root, 'vitest.config.mts')],
      { cwd: root, encoding: 'utf8', env: { ...process.env, CI: 'true' }, timeout: 60_000 },
    )
    expect(`${result.stdout}\n${result.stderr}`).toMatch(/1 passed/)
    expect(result.status).toBe(0)
  }, 60_000)
})
