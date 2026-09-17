import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

import { afterAll, describe, expect, it } from 'vitest'

import {
  assertLocalDevPortAvailable,
  findCheckoutRoot,
  isLinkedWorktree,
  isPortInUse,
  normalizePort,
  resolveLocalDevPort,
  shouldReuseExistingServer,
} from '../src/playwright/dev-port.js'

const scratch = mkdtempSync(join(tmpdir(), 'narduk-dev-port-'))
afterAll(() => rmSync(scratch, { recursive: true, force: true }))

function primaryCheckout(name: string): string {
  const root = join(scratch, name)
  mkdirSync(join(root, '.git'), { recursive: true })
  return root
}

function linkedWorktree(name: string): string {
  const root = join(scratch, name)
  mkdirSync(root, { recursive: true })
  writeFileSync(join(root, '.git'), `gitdir: ${join(scratch, '.bare', 'worktrees', name)}\n`)
  return root
}

const DECLARED = 51_952

describe('isLinkedWorktree', () => {
  it('reads a primary clone as not linked', () => {
    expect(isLinkedWorktree(primaryCheckout('primary'))).toBe(false)
  })

  it('reads a `gitdir:` pointer file as linked', () => {
    expect(isLinkedWorktree(linkedWorktree('linked'))).toBe(true)
  })

  it('reads a directory that is not a checkout at all as not linked', () => {
    const root = join(scratch, 'not-a-checkout')
    mkdirSync(root, { recursive: true })
    expect(isLinkedWorktree(root)).toBe(false)
  })
})

describe('findCheckoutRoot', () => {
  it('walks up to the checkout root from a nested directory', () => {
    const root = linkedWorktree('nested-root')
    const nested = join(root, 'apps', 'web', 'tests')
    mkdirSync(nested, { recursive: true })

    expect(findCheckoutRoot(nested)).toBe(resolve(root))
  })

  it('returns null outside any checkout', () => {
    // The scratch dir itself has no `.git`; assert only that the walk does not
    // stop inside it, since a real filesystem root may be inside a repo.
    const outside = join(scratch, 'outside')
    mkdirSync(outside, { recursive: true })

    expect(findCheckoutRoot(outside)).not.toBe(resolve(outside))
  })

  it('derives the same port from a nested directory as from the checkout root', () => {
    // packed-consumer-smoke's failure mode in reverse: a config that cannot use
    // `import.meta.url` passes `process.cwd()`, which may be anywhere inside.
    const root = linkedWorktree('nested-port')
    const nested = join(root, 'apps', 'web')
    mkdirSync(nested, { recursive: true })

    expect(resolveLocalDevPort({ rootDir: nested, declaredPort: DECLARED, env: {} })).toMatchObject(
      resolveLocalDevPort({ rootDir: root, declaredPort: DECLARED, env: {} }),
    )
  })
})

describe('normalizePort', () => {
  it.each([
    ['51952', 51_952],
    [51_952, 51_952],
    ['  3000 ', 3000],
  ])('accepts %o', (input, expected) => {
    expect(normalizePort(input)).toBe(expected)
  })

  it.each([
    ['', null],
    ['abc', null],
    [0, null],
    [65_536, null],
    [3000.5, null],
    [undefined, null],
  ])('rejects %o', (input, expected) => {
    expect(normalizePort(input)).toBe(expected)
  })
})

describe('resolveLocalDevPort', () => {
  it('keeps the declared port in the primary checkout, so muscle memory and localhost allowlists survive', () => {
    const resolution = resolveLocalDevPort({
      rootDir: primaryCheckout('primary-declared'),
      declaredPort: DECLARED,
      env: {},
    })

    expect(resolution).toMatchObject({ port: DECLARED, source: 'declared', linkedWorktree: false })
  })

  it('derives an offset port in a linked worktree with no env set', () => {
    const root = linkedWorktree('derive-a')
    const resolution = resolveLocalDevPort({ rootDir: root, declaredPort: DECLARED, env: {} })

    expect(resolution.source).toBe('derived')
    expect(resolution.linkedWorktree).toBe(true)
    expect(resolution.declaredPort).toBe(DECLARED)
    expect(resolution.port).not.toBe(DECLARED)
    expect(resolution.port).toBeGreaterThanOrEqual(DECLARED)
    expect(resolution.port).toBeLessThan(DECLARED + 1000)
  })

  it('derives the same port for the same checkout on every run', () => {
    const root = linkedWorktree('derive-stable')
    const first = resolveLocalDevPort({ rootDir: root, declaredPort: DECLARED, env: {} })
    const second = resolveLocalDevPort({ rootDir: root, declaredPort: DECLARED, env: {} })

    expect(second.port).toBe(first.port)
  })

  it('derives different ports for different worktrees of the same app', () => {
    // The whole point of narduk-libs#417: two lanes, one app, one machine.
    const ports = ['lane-one', 'lane-two', 'lane-three', 'lane-four'].map(
      (name) =>
        resolveLocalDevPort({
          rootDir: linkedWorktree(name),
          declaredPort: DECLARED,
          env: {},
        }).port,
    )

    expect(new Set(ports).size).toBe(ports.length)
  })

  it.each([
    ['PLAYWRIGHT_PORT', { PLAYWRIGHT_PORT: '51999' }],
    ['NUXT_PORT', { NUXT_PORT: '51999' }],
  ])('lets %s win over derivation', (envVar, env) => {
    const resolution = resolveLocalDevPort({
      rootDir: linkedWorktree(`override-${envVar}`),
      declaredPort: DECLARED,
      env,
    })

    expect(resolution).toMatchObject({ port: 51_999, source: 'env', envVar })
  })

  it('prefers PLAYWRIGHT_PORT over NUXT_PORT', () => {
    const resolution = resolveLocalDevPort({
      rootDir: linkedWorktree('override-order'),
      declaredPort: DECLARED,
      env: { PLAYWRIGHT_PORT: '51998', NUXT_PORT: '51997' },
    })

    expect(resolution).toMatchObject({ port: 51_998, envVar: 'PLAYWRIGHT_PORT' })
  })

  it('ignores an unusable override rather than failing the run', () => {
    const resolution = resolveLocalDevPort({
      rootDir: primaryCheckout('override-garbage'),
      declaredPort: DECLARED,
      env: { PLAYWRIGHT_PORT: 'not-a-port' },
    })

    expect(resolution).toMatchObject({ port: DECLARED, source: 'declared' })
  })

  it('never derives under CI, so the pipeline keeps the port it has always used', () => {
    // Belt and braces: a CI checkout is a primary clone anyway, but a runner
    // that ever does check out a linked worktree must not silently move.
    const resolution = resolveLocalDevPort({
      rootDir: linkedWorktree('ci-checkout'),
      declaredPort: DECLARED,
      env: { CI: '1' },
    })

    expect(resolution).toMatchObject({ port: DECLARED, source: 'declared', linkedWorktree: true })
  })

  it('slides the window down instead of deriving past the last legal port', () => {
    for (const name of ['high-a', 'high-b', 'high-c']) {
      const resolution = resolveLocalDevPort({
        rootDir: linkedWorktree(name),
        declaredPort: 65_500,
        env: {},
      })

      expect(resolution.port).toBeGreaterThanOrEqual(64_536)
      expect(resolution.port).toBeLessThanOrEqual(65_535)
    }
  })

  it('honours a custom span', () => {
    const resolution = resolveLocalDevPort({
      rootDir: linkedWorktree('custom-span'),
      declaredPort: DECLARED,
      env: {},
      span: 10,
    })

    expect(resolution.port).toBeGreaterThanOrEqual(DECLARED)
    expect(resolution.port).toBeLessThan(DECLARED + 10)
  })
})

describe('shouldReuseExistingServer', () => {
  const derived = { source: 'derived' } as Parameters<
    typeof shouldReuseExistingServer
  >[0]['resolution']
  const declared = { source: 'declared' } as typeof derived

  it('reuses in the primary checkout, keeping the human fast loop', () => {
    expect(shouldReuseExistingServer({ resolution: declared, env: {} })).toBe(true)
  })

  it('refuses to reuse a server it did not start on a derived port', () => {
    expect(shouldReuseExistingServer({ resolution: derived, env: {} })).toBe(false)
  })

  it.each([['1'], ['true'], ['TRUE']])('opts back in with PLAYWRIGHT_REUSE_SERVER=%s', (value) => {
    expect(
      shouldReuseExistingServer({ resolution: derived, env: { PLAYWRIGHT_REUSE_SERVER: value } }),
    ).toBe(true)
  })

  it.each([['0'], ['false']])('opts out with PLAYWRIGHT_REUSE_SERVER=%s', (value) => {
    expect(
      shouldReuseExistingServer({ resolution: declared, env: { PLAYWRIGHT_REUSE_SERVER: value } }),
    ).toBe(false)
  })

  it('never reuses under CI', () => {
    expect(shouldReuseExistingServer({ resolution: declared, env: { CI: '1' } })).toBe(false)
  })
})

describe('isPortInUse', () => {
  it('reports a free port as free and a bound port as in use', async () => {
    const server = createServer()
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const { port } = server.address() as { port: number }

    try {
      expect(isPortInUse(port)).toBe(true)
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()))
    }

    expect(isPortInUse(port)).toBe(false)
  })
})

describe('assertLocalDevPortAvailable', () => {
  const resolution = resolveLocalDevPort({
    rootDir: linkedWorktree('assert-root'),
    declaredPort: DECLARED,
    env: {},
  })

  it('names the port and the override when the port is taken', () => {
    expect(() =>
      assertLocalDevPortAvailable({ resolution, env: {}, probe: () => true }),
    ).toThrowError(new RegExp(`${resolution.port}[\\s\\S]*PLAYWRIGHT_PORT`))
  })

  it('passes when the port is free', () => {
    expect(() =>
      assertLocalDevPortAvailable({ resolution, env: {}, probe: () => false }),
    ).not.toThrow()
  })

  it('fails open when the probe itself cannot answer', () => {
    expect(() =>
      assertLocalDevPortAvailable({ resolution, env: {}, probe: () => null }),
    ).not.toThrow()
  })

  it('no-ops inside a Playwright worker, where our own server holds the port', () => {
    expect(() =>
      assertLocalDevPortAvailable({
        resolution,
        env: { TEST_WORKER_INDEX: '0' },
        probe: () => true,
      }),
    ).not.toThrow()
  })

  it('no-ops under CI', () => {
    expect(() =>
      assertLocalDevPortAvailable({ resolution, env: { CI: '1' }, probe: () => true }),
    ).not.toThrow()
  })
})
