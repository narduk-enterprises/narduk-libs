import { describe, expect, it } from 'vitest'

import { resolveBuildVersion } from '../src/build-version'

const SHA = '0123456789abcdef0123456789abcdef01234567'
const noGit = () => ''

describe('resolveBuildVersion', () => {
  it('reads the Workers Builds commit without asking git (narduk-libs#584)', () => {
    const git = () => {
      throw new Error('git must not be consulted when the builder names the commit')
    }
    expect(resolveBuildVersion({ WORKERS_CI_COMMIT_SHA: SHA }, git, '0.1.0')).toBe('0123456789ab')
  })

  it('keeps the existing order ahead of the Workers Builds variable', () => {
    const env = { WORKERS_CI_COMMIT_SHA: SHA, CF_PAGES_COMMIT_SHA: 'pages000000000' }
    expect(resolveBuildVersion(env, noGit, '0.1.0')).toBe('pages0000000')
    expect(resolveBuildVersion({ ...env, GITHUB_SHA: 'gh0000000000000' }, noGit, '0.1.0')).toBe(
      'gh0000000000',
    )
    expect(resolveBuildVersion({ ...env, BUILD_VERSION: 'explicit' }, noGit, '0.1.0')).toBe(
      'explicit',
    )
  })

  it('falls back to git, then to the app version', () => {
    expect(resolveBuildVersion({}, () => 'abcdefabcdef', '0.1.0')).toBe('abcdefabcdef')
    expect(resolveBuildVersion({ WORKERS_CI_COMMIT_SHA: '' }, noGit, '0.1.0')).toBe('0.1.0')
  })
})
