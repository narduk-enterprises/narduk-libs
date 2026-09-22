import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { developmentSchema } from '../src/development-config.js'
import { defaultDeploymentBlock, deploymentBlockJsonSchema } from '../src/deployment-config.js'
import {
  developmentBuildEnvironment,
  prepareDevelopmentDependencies,
  runDevelopmentCommand,
} from '../src/development-process.js'
import type { SourceSnapshot } from '../src/development-source.js'
import { developmentFixture } from './development-fixture.js'

const roots: string[] = []
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})
function fixture(): string {
  const root = mkdtempSync(join(tmpdir(), 'dev-process-'))
  roots.push(root)
  return root
}

describe('development capability and phase isolation', () => {
  it('preserves existing configurations and projects development through the existing schema', () => {
    expect(defaultDeploymentBlock({ appSlug: 'example' }).development).toBeUndefined()
    expect(JSON.stringify(deploymentBlockJsonSchema())).toContain('defaultTargetSet')
    const config = developmentFixture()
    expect(developmentSchema.safeParse(config).success).toBe(true)
    config.automation.workflows.push(config.automation.manualValidationWorkflow)
    expect(developmentSchema.safeParse(config).success).toBe(false)
  })
  it('refuses wrong target references, traversal and process control overrides', () => {
    for (const mutate of [
      (config: ReturnType<typeof developmentFixture>) => {
        config.defaultTargetSet = 'absent'
      },
      (config: ReturnType<typeof developmentFixture>) => {
        config.components.web.appDir = '../outside'
      },
      (config: ReturnType<typeof developmentFixture>) => {
        config.targetSets.primary.components.push('web')
      },
      (config: ReturnType<typeof developmentFixture>) => {
        config.components.web.buildVariables.WORKERS_CI_BRANCH = 'main'
      },
      (config: ReturnType<typeof developmentFixture>) => {
        config.components.web.buildSecrets.PATH = config.components.web.deploymentCredential
      },
    ]) {
      const config = developmentFixture()
      mutate(config)
      expect(developmentSchema.safeParse(config).success).toBe(false)
    }
  })
  it('builds from declared inputs without ambient Git, provider or public Nuxt configuration', () => {
    const component = developmentFixture().components.web
    component.buildVariables.NUXT_PUBLIC_IMPORT_ENVIRONMENT = 'prd'
    component.buildSecrets.NUXT_SESSION_PASSWORD = {
      ...component.deploymentCredential,
      key: 'SIGNING_SECRET',
    }
    const read = vi.fn(() => 'a'.repeat(40))
    const env = developmentBuildEnvironment(component, 'dev-unique', read, {
      PATH: '/usr/bin',
      HOME: '/private/home',
      NUXT_PUBLIC_IMPORT_ENVIRONMENT: 'prv',
      NUXT_PUBLIC_UNDECLARED: 'wrong',
      CLOUDFLARE_API_TOKEN: 'deploy-secret',
      GH_PACKAGES_READ: 'package-secret',
      GIT_SSH_COMMAND: 'wrong',
      WORKERS_CI_BRANCH: 'main',
    })
    expect(env.NUXT_PUBLIC_IMPORT_ENVIRONMENT).toBe('prd')
    expect(env.BUILD_VERSION).toBe('dev-unique')
    expect(env.NARDUK_ALLOW_LOCAL_WRANGLER_DEPLOY).toBe('1')
    for (const key of [
      'CLOUDFLARE_API_TOKEN',
      'GH_PACKAGES_READ',
      'GIT_SSH_COMMAND',
      'WORKERS_CI_BRANCH',
      'NUXT_PUBLIC_UNDECLARED',
    ])
      expect(env[key]).toBeUndefined()
    expect(read).toHaveBeenCalledOnce()
    expect(() =>
      developmentBuildEnvironment(component, 'dev-unique', () => 'narduk-test-only-placeholder'),
    ).toThrow('placeholder')
    expect(() => developmentBuildEnvironment(component, 'dev-unique', () => 'too-short')).toThrow(
      'real production build secret',
    )
  })
  it('passes arguments literally and redacts declared secrets from child output', () => {
    const root = fixture()
    const log = vi.fn()
    const message = '$(touch escaped); this is literal'
    runDevelopmentCommand(
      {
        executable: process.execPath,
        args: ['-e', 'console.log(process.argv[1]); console.log(process.env.SECRET)', message],
        cwd: '.',
        timeoutSeconds: 5,
      },
      root,
      { SECRET: 'fixture-value' },
      { log, redact: ['fixture-value'] },
    )
    expect(log).toHaveBeenCalledWith(`${message}\n[REDACTED]\n`)
  })
  it('does not run an install or request package auth on an unchanged warm workspace', () => {
    const root = fixture()
    const workspace = join(root, 'build')
    mkdirSync(workspace)
    const snapshot: SourceSnapshot = {
      schemaVersion: 1,
      directory: join(root, 'source'),
      baseCommit: 'a'.repeat(40),
      digest: 'fixture',
      entries: [],
    }
    const install = developmentFixture().install
    const run = vi.fn((_command, cwd, env) => {
      expect(env.CLOUDFLARE_API_TOKEN).toBeUndefined()
      expect(env.GH_PACKAGES_READ).toBeUndefined()
      mkdirSync(join(cwd, 'node_modules'), { recursive: true })
      writeFileSync(join(cwd, 'node_modules', 'installed'), 'fixture')
    })
    const options = {
      run,
      env: {
        PATH: '/bin',
        CLOUDFLARE_API_TOKEN: 'must-not-inherit',
        GH_PACKAGES_READ: 'session-secret',
      },
    }
    expect(
      prepareDevelopmentDependencies(snapshot, workspace, root, install, '10.33.4', options).reused,
    ).toBe(false)
    expect(
      prepareDevelopmentDependencies(snapshot, workspace, root, install, '10.33.4', options).reused,
    ).toBe(true)
    expect(run).toHaveBeenCalledOnce()
    expect(
      prepareDevelopmentDependencies(snapshot, workspace, root, install, '10.34.0', options).reused,
    ).toBe(false)
    expect(run).toHaveBeenCalledTimes(2)
  })
})
