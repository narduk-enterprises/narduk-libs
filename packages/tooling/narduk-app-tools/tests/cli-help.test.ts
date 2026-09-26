import { describe, expect, it, vi } from 'vitest'

import { argsRequestHelp, main } from '../src/cli.js'

/** Every command the dispatcher accepts. `--help` must win before any of them run. */
const COMMANDS: string[][] = [
  ['dev'],
  ['ensure-generated'],
  ['check-starter-identity'],
  ['dev:seed'],
  ['e2e-serve'],
  ['og:check'],
  ['og:generate'],
  ['auth'],
  ['auth', 'agent-key', 'create'],
  ['db'],
  ['db', 'migrate'],
  ['db', 'status'],
  ['db', 'baseline'],
  ['db', 'bundle'],
  ['db', 'create'],
  ['db', 'migrate-deployment'],
  ['deploy'],
  ['deploy', 'versions-promote'],
  ['deploy', 'rollback'],
  ['verify'],
  ['deploy-local'],
  ['development'],
  ['development', 'status'],
  ['deploy-hotfix'],
  ['registry-auth'],
  ['gh-packages-run'],
  ['doctor'],
  ['doctor', '--adoption'],
  ['doctor', '--all'],
  ['doctor', '--audit'],
  ['performance-budget'],
  ['assets'],
  ['assets', 'favicons'],
  ['favicons'],
  ['foundation:check'],
  ['foundation:check:security-headers'],
  ['foundation:check:shared-ui-pinned'],
  ['foundation:check:no-local-copy'],
  ['foundation:check:list-routes'],
  ['foundation:check:toolchain'],
  ['foundation:check:deployment'],
  ['foundation:check:coverage'],
  ['manifests'],
  ['manifests', 'validate'],
]

describe('subcommand --help', () => {
  it.each(COMMANDS)('%s --help prints help and exits 0', async (...command) => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      expect(await main([...command, '--help'])).toBe(0)
      const text = log.mock.calls.map((call) => call.map(String).join(' ')).join('\n')
      expect(text).toContain('Usage: narduk-app')
      expect(text).toContain(command[0])
      expect(text).not.toContain('[registry-auth]')
      expect(error).not.toHaveBeenCalled()
    } finally {
      log.mockRestore()
      error.mockRestore()
    }
  })

  it('accepts -h on a subcommand', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    try {
      expect(await main(['foundation:check', '-h'])).toBe(0)
      expect(log.mock.calls.map((call) => String(call[0])).join('\n')).toContain('foundation:check')
    } finally {
      log.mockRestore()
    }
  })

  it('does not treat --help after -- as narduk-app help', () => {
    expect(argsRequestHelp(['dev', '--', 'nuxt', '--help'])).toBe(false)
    expect(argsRequestHelp(['gh-packages-run', '--', 'pnpm', '--help'])).toBe(false)
    expect(argsRequestHelp(['og:check', '--help'])).toBe(true)
    expect(argsRequestHelp(['foundation:check', '--json', '--help'])).toBe(true)
  })
})
