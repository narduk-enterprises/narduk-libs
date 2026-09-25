import { afterEach, describe, expect, it, vi } from 'vitest'

import { resolveBuildDeploymentTarget } from '../shared/deploymentTarget'

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('resolveBuildDeploymentTarget', () => {
  it('uses an explicit NARDUK_DEPLOY_TARGET, trimmed and lowercased', () => {
    expect(resolveBuildDeploymentTarget({ NARDUK_DEPLOY_TARGET: '  Staging ' })).toEqual({
      target: 'staging',
      source: 'explicit',
    })
  })

  it('reads the NUXT_PUBLIC_ variables in readDeploymentTarget precedence', () => {
    expect(
      resolveBuildDeploymentTarget({
        NUXT_PUBLIC_NARDUK_DEPLOY_TARGET: 'preview',
        NUXT_PUBLIC_DEPLOYMENT_TARGET: 'staging',
      }),
    ).toEqual({ target: 'preview', source: 'explicit' })
    expect(resolveBuildDeploymentTarget({ NUXT_PUBLIC_DEPLOYMENT_TARGET: 'staging' })).toEqual({
      target: 'staging',
      source: 'explicit',
    })
    expect(
      resolveBuildDeploymentTarget({
        NARDUK_DEPLOY_TARGET: 'production',
        NUXT_PUBLIC_NARDUK_DEPLOY_TARGET: 'preview',
        WORKERS_CI_BRANCH: 'feature/x',
      }),
    ).toEqual({ target: 'production', source: 'explicit' })
  })

  it('ignores blank explicit values', () => {
    expect(
      resolveBuildDeploymentTarget({
        NARDUK_DEPLOY_TARGET: '   ',
        NUXT_PUBLIC_NARDUK_DEPLOY_TARGET: 'staging',
      }),
    ).toEqual({ target: 'staging', source: 'explicit' })
  })

  it('falls through an unrecognised explicit value to the branch', () => {
    expect(
      resolveBuildDeploymentTarget({ NARDUK_DEPLOY_TARGET: 'prod', WORKERS_CI_BRANCH: 'main' }),
    ).toEqual({ target: 'production', source: 'branch' })
    expect(resolveBuildDeploymentTarget({ NARDUK_DEPLOY_TARGET: 'dev' })).toEqual({
      target: 'production',
      source: 'default',
    })
  })

  it('derives the target from the Workers Builds branch', () => {
    expect(resolveBuildDeploymentTarget({ WORKERS_CI_BRANCH: 'main' })).toEqual({
      target: 'production',
      source: 'branch',
    })
    expect(resolveBuildDeploymentTarget({ WORKERS_CI_BRANCH: ' feature/login ' })).toEqual({
      target: 'preview',
      source: 'branch',
    })
  })

  it('falls back to the Pages branch and honours a custom production branch', () => {
    expect(resolveBuildDeploymentTarget({ CF_PAGES_BRANCH: 'main' })).toEqual({
      target: 'production',
      source: 'branch',
    })
    expect(
      resolveBuildDeploymentTarget(
        { WORKERS_CI_BRANCH: 'release', CF_PAGES_BRANCH: 'main' },
        { productionBranch: 'release' },
      ),
    ).toEqual({ target: 'production', source: 'branch' })
    expect(
      resolveBuildDeploymentTarget({ WORKERS_CI_BRANCH: 'main' }, { productionBranch: 'release' }),
    ).toEqual({ target: 'preview', source: 'branch' })
    expect(
      resolveBuildDeploymentTarget({ WORKERS_CI_BRANCH: '  ', CF_PAGES_BRANCH: 'feature' }),
    ).toEqual({ target: 'preview', source: 'branch' })
  })

  it('returns the default when nothing is set', () => {
    expect(resolveBuildDeploymentTarget({})).toEqual({ target: 'production', source: 'default' })
    expect(resolveBuildDeploymentTarget({}, { default: 'preview' })).toEqual({
      target: 'preview',
      source: 'default',
    })
  })

  it('reads process.env when no env is passed', () => {
    vi.stubEnv('NARDUK_DEPLOY_TARGET', '')
    vi.stubEnv('NUXT_PUBLIC_NARDUK_DEPLOY_TARGET', '')
    vi.stubEnv('NUXT_PUBLIC_DEPLOYMENT_TARGET', '')
    vi.stubEnv('CF_PAGES_BRANCH', '')
    vi.stubEnv('WORKERS_CI_BRANCH', 'feature/x')

    expect(resolveBuildDeploymentTarget()).toEqual({ target: 'preview', source: 'branch' })
  })
})
