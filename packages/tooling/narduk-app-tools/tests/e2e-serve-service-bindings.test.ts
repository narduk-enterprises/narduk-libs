import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it, vi } from 'vitest'

import { main } from '../src/cli.js'
import { parseE2eServeArgs } from '../src/e2e-serve/e2e-serve.js'
import {
  describeDroppedServiceBinding,
  planE2eServiceBindings,
  stripExternalServiceBindings,
  WRANGLER_INLINE_CONFIG_MIN_VERSION,
  wranglerSupportsInlineConfig,
} from '../src/e2e-serve/service-bindings.js'

const tempDirs: string[] = []

afterEach(() => {
  vi.restoreAllMocks()
  delete (globalThis as { __e2eStartConfig?: unknown }).__e2eStartConfig
  for (const path of tempDirs.splice(0)) rmSync(path, { force: true, recursive: true })
})

describe('planE2eServiceBindings', () => {
  it('keeps a binding to the Worker itself and drops every other Worker', () => {
    const self = { binding: 'SELF', service: 'loadtest-dev' }
    const engine = { binding: 'ENGINE', service: 'loadtest-dev-engine' }
    const auth = { binding: 'AUTH', service: 'auth', entrypoint: 'AuthRpc' }

    expect(planE2eServiceBindings('loadtest-dev', [self, engine, auth])).toEqual({
      keep: [self],
      drop: [engine, auth],
    })
  })

  it('treats a missing services list as nothing to drop', () => {
    expect(planE2eServiceBindings('app', undefined)).toEqual({ keep: [], drop: [] })
    expect(planE2eServiceBindings('app', [])).toEqual({ keep: [], drop: [] })
  })

  it('drops everything when the Worker has no name to match', () => {
    const entry = { binding: 'ENGINE', service: 'engine' }
    expect(planE2eServiceBindings(undefined, [entry])).toEqual({ keep: [], drop: [entry] })
  })
})

describe('stripExternalServiceBindings', () => {
  it('returns the same config object when nothing is dropped', () => {
    const config = { name: 'app', services: [{ binding: 'SELF', service: 'app' }] }
    const result = stripExternalServiceBindings(config)
    expect(result.config).toBe(config)
    expect(result.dropped).toEqual([])

    const bare = { name: 'app', main: 'index.mjs' }
    expect(stripExternalServiceBindings(bare)).toEqual({ config: bare, dropped: [] })
  })

  it('removes external bindings without mutating the input or other fields', () => {
    const config = {
      name: 'loadtest-dev',
      compatibility_date: '2026-01-01',
      services: [
        { binding: 'ENGINE', service: 'loadtest-dev-engine' },
        { binding: 'SELF', service: 'loadtest-dev' },
      ],
      d1_databases: [{ binding: 'DB', database_id: 'x' }],
    }
    const snapshot = structuredClone(config)

    const result = stripExternalServiceBindings(config)
    expect(result.config).toEqual({
      ...snapshot,
      services: [{ binding: 'SELF', service: 'loadtest-dev' }],
    })
    expect(result.dropped).toEqual([{ binding: 'ENGINE', service: 'loadtest-dev-engine' }])
    expect(config).toEqual(snapshot)
  })
})

describe('describeDroppedServiceBinding', () => {
  it('names the binding and target Worker', () => {
    expect(
      describeDroppedServiceBinding({ binding: 'ENGINE', service: 'loadtest-dev-engine' }),
    ).toBe('dropping service binding ENGINE → loadtest-dev-engine (not part of the E2E run)')
    expect(
      describeDroppedServiceBinding({ binding: 'AUTH', service: 'auth', entrypoint: 'AuthRpc' }),
    ).toBe('dropping service binding AUTH → auth (entrypoint AuthRpc) (not part of the E2E run)')
  })
})

describe('wranglerSupportsInlineConfig', () => {
  it('compares against the first wrangler that takes a config object', () => {
    // Wrangler's version, not this package's own: toEqual keeps
    // scripts/package-version-assertions.test.mjs, which looks for a
    // `.toBe('x.y.z')` on a manifest version, from reading it as one.
    expect(WRANGLER_INLINE_CONFIG_MIN_VERSION).toEqual('4.99.0')
    expect(wranglerSupportsInlineConfig('4.99.0')).toBe(true)
    expect(wranglerSupportsInlineConfig('4.107.0')).toBe(true)
    expect(wranglerSupportsInlineConfig('5.0.0')).toBe(true)
    expect(wranglerSupportsInlineConfig('4.98.9')).toBe(false)
    expect(wranglerSupportsInlineConfig('4.90.1')).toBe(false)
    expect(wranglerSupportsInlineConfig('3.114.0')).toBe(false)
  })

  it('treats an unknown version as unsupported', () => {
    expect(wranglerSupportsInlineConfig(undefined)).toBe(false)
    expect(wranglerSupportsInlineConfig('latest')).toBe(false)
  })
})

describe('e2e-serve --keep-service-bindings', () => {
  it('defaults off and is accepted as a bare flag', () => {
    const root = tempDir('narduk-e2e-serve-keep-flag-')
    writeFileSync(join(root, 'wrangler.json'), '{"name":"fixture"}\n')

    expect(parseE2eServeArgs(['4401'], {}, root).keepServiceBindings).toBe(false)
    expect(
      parseE2eServeArgs(['--keep-service-bindings', '4401'], {}, root).keepServiceBindings,
    ).toBe(true)
  })
})

describe('e2e-serve service bindings with a stub wrangler', () => {
  const externalConfig = {
    name: 'loadtest-dev',
    services: [
      { binding: 'ENGINE', service: 'loadtest-dev-engine' },
      { binding: 'SELF', service: 'loadtest-dev' },
    ],
  }

  it('starts from the config without external bindings and names each one', async () => {
    const root = stubApp('4.107.0', externalConfig)
    const stderr = captureStderr()
    vi.spyOn(console, 'error').mockImplementation(() => {})

    expect(await main(['e2e-serve', '4401', '--cwd', root])).toBe(1)
    expect(startConfig()).toEqual({
      name: 'loadtest-dev',
      services: [{ binding: 'SELF', service: 'loadtest-dev' }],
    })
    expect(stderr()).toContain(
      '[e2e-serve] dropping service binding ENGINE → loadtest-dev-engine (not part of the E2E run)',
    )
    expect(stderr()).not.toContain('service binding SELF')
  })

  it('passes the config path through when there is nothing to drop', async () => {
    const root = stubApp('4.107.0', { name: 'app', services: [{ binding: 'S', service: 'app' }] })
    captureStderr()
    vi.spyOn(console, 'error').mockImplementation(() => {})

    expect(await main(['e2e-serve', '4401', '--cwd', root])).toBe(1)
    expect(startConfig()).toBe(join(root, 'wrangler.json'))
  })

  it('passes the config path through untouched with --keep-service-bindings', async () => {
    const root = stubApp('4.107.0', externalConfig)
    const stderr = captureStderr()
    vi.spyOn(console, 'error').mockImplementation(() => {})

    expect(await main(['e2e-serve', '4401', '--cwd', root, '--keep-service-bindings'])).toBe(1)
    expect(startConfig()).toBe(join(root, 'wrangler.json'))
    expect(stderr()).toContain('[e2e-serve] keeping every service binding')
    expect(stderr()).not.toContain('dropping service binding')
  })

  it('refuses with the upgrade path when wrangler cannot take a config object', async () => {
    const root = stubApp('4.90.1', externalConfig)
    captureStderr()
    const lines: string[] = []
    vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
      lines.push(args.map(String).join(' '))
    })

    expect(await main(['e2e-serve', '4401', '--cwd', root])).toBe(1)
    expect(startConfig()).toBeUndefined()
    const message = lines.join('\n')
    expect(message).toContain('wrangler 4.90.1')
    expect(message).toContain('ENGINE')
    expect(message).toContain('>=4.99.0')
    expect(message).toContain('--keep-service-bindings')
  })
})

function tempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix))
  tempDirs.push(dir)
  return dir
}

/**
 * An app with a prebuilt artifact and a stub `wrangler` whose
 * `unstable_readConfig` returns `config` and whose `unstable_startWorker`
 * records the config it was handed, then fails so the command returns.
 */
function stubApp(version: string, config: Record<string, unknown>): string {
  const root = tempDir('narduk-e2e-serve-services-')
  writeFileSync(join(root, 'package.json'), '{"name":"fixture","type":"module"}\n')
  writeFileSync(join(root, 'wrangler.json'), `${JSON.stringify(config)}\n`)
  mkdirSync(join(root, '.output', 'server'), { recursive: true })
  writeFileSync(join(root, '.output', 'server', 'index.mjs'), 'export default {}\n')

  const wranglerDir = join(root, 'node_modules', 'wrangler')
  mkdirSync(wranglerDir, { recursive: true })
  writeFileSync(
    join(wranglerDir, 'package.json'),
    JSON.stringify({ name: 'wrangler', version, main: 'index.mjs' }),
  )
  writeFileSync(
    join(wranglerDir, 'index.mjs'),
    [
      `const config = ${JSON.stringify(config)}`,
      'export function unstable_readConfig() { return structuredClone(config) }',
      'export async function unstable_startWorker(options) {',
      '  globalThis.__e2eStartConfig = options.config',
      "  throw new Error('stub start')",
      '}',
      '',
    ].join('\n'),
  )
  return root
}

function startConfig(): unknown {
  return (globalThis as { __e2eStartConfig?: unknown }).__e2eStartConfig
}

function captureStderr(): () => string {
  let text = ''
  vi.spyOn(process.stderr, 'write').mockImplementation((chunk: string | Uint8Array) => {
    text += typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8')
    return true
  })
  return () => text
}
