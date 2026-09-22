import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { main } from '../src/cli.js'
import { assertAppCheckout } from '../src/commands/checkout-root.js'

// narduk-libs#679: generated apps ran foundation checks from apps/web with
// `--checkout ..`, which is apps/. Item 12 read that as "no deployment block"
// and exited 0, the same output as an app that has not adopted the standard.
let repo: string

beforeAll(() => {
  repo = mkdtempSync(join(tmpdir(), 'narduk-checkout-root-'))
  mkdirSync(join(repo, 'apps', 'web'), { recursive: true })
  writeFileSync(join(repo, 'package.json'), '{"name":"fixture","private":true}\n')
  writeFileSync(join(repo, 'apps', 'web', 'package.json'), '{"name":"web","private":true}\n')
})

afterAll(() => {
  if (repo) rmSync(repo, { force: true, recursive: true })
})

describe('assertAppCheckout', () => {
  it('accepts the repository root and the web package', () => {
    expect(() => assertAppCheckout(repo, 'foundation:check')).not.toThrow()
    expect(() => assertAppCheckout(join(repo, 'apps', 'web'), 'foundation:check')).not.toThrow()
  })

  it('refuses apps/, naming the command, the directory and the fix', () => {
    const apps = join(repo, 'apps')
    expect(() => assertAppCheckout(apps, 'foundation:check:deployment')).toThrow(
      `foundation:check:deployment: --checkout ${apps} has no package.json`,
    )
    expect(() => assertAppCheckout(apps, 'foundation:check:deployment')).toThrow('../..')
  })
})

describe('the foundation commands refuse a checkout that is not an app', () => {
  it.each([
    'foundation:check',
    'foundation:check:shared-ui-pinned',
    'foundation:check:toolchain',
    'foundation:check:deployment',
    'foundation:check:coverage',
  ])('%s exits non-zero before evaluating anything', async (command) => {
    const errors: string[] = []
    const logs: string[] = []
    const originalError = console.error
    const originalLog = console.log
    console.error = (message: unknown) => errors.push(String(message))
    console.log = (message: unknown) => logs.push(String(message))
    try {
      expect(await main([command, '--checkout', join(repo, 'apps')])).toBe(1)
    } finally {
      console.error = originalError
      console.log = originalLog
    }
    expect(errors.join('\n')).toContain('has no package.json')
    expect(logs).toEqual([])
  })
})
