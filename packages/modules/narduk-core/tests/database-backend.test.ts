import { describe, expect, it, vi } from 'vitest'

import {
  findDatabaseBackendConflict,
  isDatabaseBackendDeclared,
  resolveDatabaseBackendSelection,
  usesNardukAuth,
} from '../runtime/shared/database-backend'

describe('resolveDatabaseBackendSelection', () => {
  it('prefers the module option, then the environment, then runtimeConfig', () => {
    const warn = vi.fn()
    expect(
      resolveDatabaseBackendSelection(
        {
          option: 'none',
          env: 'postgres',
          runtimeConfig: { databaseBackend: 'd1', databaseBackendSource: 'default' },
        },
        warn,
      ),
    ).toEqual({ backend: 'none', source: 'option' })
    expect(
      resolveDatabaseBackendSelection(
        { env: ' postgres ', runtimeConfig: { databaseBackend: 'none' } },
        warn,
      ),
    ).toEqual({ backend: 'postgres', source: 'env' })
    expect(
      resolveDatabaseBackendSelection({ env: '', runtimeConfig: { databaseBackend: 'none' } }, warn),
    ).toEqual({ backend: 'none', source: 'runtimeConfig' })
    expect(resolveDatabaseBackendSelection({}, warn)).toEqual({ backend: 'd1', source: 'default' })
    expect(warn).not.toHaveBeenCalled()
  })

  it('keeps the source an earlier run recorded, so the default never becomes a declaration', () => {
    const first = resolveDatabaseBackendSelection({})
    expect(
      resolveDatabaseBackendSelection({
        runtimeConfig: { databaseBackend: first.backend, databaseBackendSource: first.source },
      }),
    ).toEqual({ backend: 'd1', source: 'default' })
    expect(
      resolveDatabaseBackendSelection({
        runtimeConfig: { databaseBackend: 'none', databaseBackendSource: 'option' },
      }),
    ).toEqual({ backend: 'none', source: 'option' })
  })

  it('rejects an invalid module option', () => {
    expect(() => resolveDatabaseBackendSelection({ option: 'sqlite' })).toThrow(
      "[narduk-core] nardukCore.databaseBackend must be one of 'd1', 'postgres', 'none'; received \"sqlite\".",
    )
  })

  it('warns about unrecognized environment and runtimeConfig values and keeps resolving', () => {
    const warn = vi.fn()
    expect(
      resolveDatabaseBackendSelection({ env: 'mysql', runtimeConfig: { databaseBackend: 'sqlite' } }, warn),
    ).toEqual({ backend: 'd1', source: 'default' })
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('NUXT_DATABASE_BACKEND="mysql"'))
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('runtimeConfig.databaseBackend="sqlite"'))
  })
})

describe('isDatabaseBackendDeclared', () => {
  it.each([
    ['option', true],
    ['env', true],
    ['runtimeConfig', true],
    ['default', false],
    [undefined, false],
    ['anything', false],
  ])('treats source %s as declared=%s', (source, declared) => {
    expect(isDatabaseBackendDeclared(source)).toBe(declared)
  })
})

describe('narduk-auth conflict (Q3: build fails clearly)', () => {
  it.each([
    ['the narduk-auth health flag', { nardukHealth: { authTables: true } }],
    ['an authBackend from an older narduk-auth', { authBackend: 'local' }],
  ])('rejects databaseBackend none with %s', (_label, auth) => {
    expect(usesNardukAuth(auth)).toBe(true)
    expect(findDatabaseBackendConflict({ databaseBackend: 'none', ...auth })).toBe(
      "[narduk-core] databaseBackend 'none' conflicts with @narduk-enterprises/narduk-auth: " +
        'sign-in stores users, sessions and API keys in the app database. Remove narduk-auth, ' +
        "or declare databaseBackend 'd1' or 'postgres'.",
    )
  })

  it.each([
    [{ databaseBackend: 'none' }],
    [{ databaseBackend: 'none', authBackend: '', nardukHealth: { authTables: false } }],
    [{ databaseBackend: 'd1', nardukHealth: { authTables: true } }],
    [{ databaseBackend: 'postgres', authBackend: 'local' }],
  ])('allows %j', (runtimeConfig) => {
    expect(findDatabaseBackendConflict(runtimeConfig)).toBeNull()
  })
})
