import { describe, expect, it } from 'vitest'

import {
  defaultDeploymentBlock,
  deploymentBlockJsonSchema,
  readDeploymentBlock,
  DEPLOYMENT_BUILDER,
} from '../src/deployment-config.js'

describe('deployment.builder', () => {
  it('retains the existing generator default', () => {
    expect(DEPLOYMENT_BUILDER).toBe('workers-builds')
    expect(defaultDeploymentBlock({ appSlug: 'fixture' }).builder).toBe('workers-builds')
  })

  describe.each(['workers-builds', 'runner-upload'])('%s', (builder) => {
    it('accepts the builder and preserves normalization and defaults', () => {
      const deployment: Record<string, unknown> = {
        ...defaultDeploymentBlock({ appSlug: 'fixture' }),
        builder,
        accountId: ` ${'a'.repeat(32)} `,
        productionBranch: ' main ',
        liveProof: { healthPath: ' /api/health ', smokePath: ' / ' },
      }
      delete deployment.staging
      delete deployment.previewBindings

      const outcome = readDeploymentBlock({ deployment })
      expect(outcome.kind).toBe('valid')
      if (outcome.kind !== 'valid') throw new Error(`expected valid, got ${outcome.kind}`)
      expect(outcome.block).toMatchObject({
        builder,
        accountId: 'a'.repeat(32),
        productionBranch: 'main',
        liveProof: {
          healthPath: '/api/health',
          smokePath: '/',
          buildVersionHeader: 'x-build-version',
          healthAuth: 'anonymous',
          attempts: 6,
          intervalSeconds: 10,
        },
        staging: { enabled: false },
        previewBindings: { d1: [], kv: [], r2: [] },
        promotion: deployment.promotion,
        rollback: deployment.rollback,
        productionDeployCommand: 'narduk-app deploy versions-upload',
        nonProductionDeployCommand: 'narduk-app deploy versions-upload',
        nonProductionBranchBuilds: false,
      })
    })

    it.each([
      { field: 'accountId', value: 'invalid', path: 'accountId' },
      {
        field: 'liveProof',
        value: { healthPath: '//other.example/health', smokePath: '/' },
        path: 'liveProof.healthPath',
      },
      {
        field: 'staging',
        value: { enabled: true, workerName: 'fixture-stage', approval: 'auto-after-proof' },
        path: 'staging.hostname',
      },
      {
        field: 'staging',
        value: {
          enabled: true,
          workerName: 'fixture-stage',
          hostname: 'https://stage.example.com/',
          approval: 'auto-after-proof',
        },
        path: 'staging.hostname',
      },
      {
        field: 'previewBindings',
        value: { d1: ['DB', { binding: ' DB ', database_id: 'preview' }] },
        path: 'previewBindings.d1.1',
      },
      {
        field: 'migrations',
        value: { compatibility: 'anything', credential: 'd1-only', databases: [] },
        path: 'migrations.compatibility',
      },
    ])('preserves the $path validation', ({ field, value, path }) => {
      const outcome = readDeploymentBlock({
        deployment: { ...defaultDeploymentBlock({ appSlug: 'fixture' }), builder, [field]: value },
      })
      expect(outcome.kind).toBe('invalid')
      if (outcome.kind !== 'invalid') throw new Error(`expected invalid, got ${outcome.kind}`)
      expect(outcome.issues.map((issue) => issue.path)).toContain(path)
    })
  })

  it.each(['unknown', 'workers-build', 'runner_upload', ' runner-upload ', '', null, 1, undefined])(
    'rejects an invalid or missing builder: %s',
    (builder) => {
      const outcome = readDeploymentBlock({
        deployment: { ...defaultDeploymentBlock({ appSlug: 'fixture' }), builder },
      })
      expect(outcome.kind).toBe('invalid')
      if (outcome.kind !== 'invalid') throw new Error(`expected invalid, got ${outcome.kind}`)
      expect(outcome.issues.map((issue) => issue.path)).toContain('builder')
    },
  )

  it('projects exactly both accepted builders for non-TypeScript consumers', () => {
    const schema = deploymentBlockJsonSchema()
    expect((schema.properties as Record<string, unknown>).builder).toEqual({
      type: 'string',
      enum: ['workers-builds', 'runner-upload'],
    })
  })
})

describe('deployment.development (removed capability)', () => {
  it('still validates a config that carries the retired block, and ignores it', () => {
    const block = defaultDeploymentBlock({ appSlug: 'fixture' })
    const outcome = readDeploymentBlock({
      deployment: {
        ...block,
        development: { enabled: true, components: [{ id: 'web', anything: ['goes'] }] },
      },
    })
    expect(outcome.kind).toBe('valid')
  })

  it('still rejects a genuinely unknown key', () => {
    const block = defaultDeploymentBlock({ appSlug: 'fixture' })
    const outcome = readDeploymentBlock({ deployment: { ...block, notAKey: true } })
    expect(outcome.kind).toBe('invalid')
  })
})
