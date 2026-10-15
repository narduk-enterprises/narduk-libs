import { describe, expect, it } from 'vitest'

import {
  defaultDeploymentBlock,
  healthArgs,
  readDeploymentBlock,
  smokeArgs,
} from '../src/deployment-config.js'
import { parseVerifyArgs } from '../src/verify-live.js'

describe('liveProof.healthAuth (narduk-libs#585)', () => {
  it('defaults to anonymous, so an existing manifest parses exactly as before', () => {
    const outcome = readDeploymentBlock({
      deployment: defaultDeploymentBlock({ appSlug: 'fixture' }),
    })
    expect(outcome.kind).toBe('valid')
    if (outcome.kind !== 'valid') return
    expect(outcome.block.liveProof.healthAuth).toBe('anonymous')
  })

  it('asks verify --live for the health path when anonymous, and for --no-health when authenticated', () => {
    expect(healthArgs({ healthAuth: 'anonymous', healthPath: '/api/health' })).toEqual([
      '--health-path',
      '/api/health',
    ])
    expect(healthArgs({ healthAuth: 'authenticated', healthPath: '/api/health' })).toEqual([
      '--no-health',
    ])
  })

  it('leaves an authenticated app with a verify that still asserts the build and the smoke path', () => {
    const flags = parseVerifyArgs([
      '--live',
      'https://ops.example',
      ...healthArgs({ healthAuth: 'authenticated', healthPath: '/api/health' }),
      '--smoke-path',
      '/login',
      '--expect-sha',
      'a'.repeat(40),
    ])
    expect(flags.healthPath).toBeNull()
    expect(flags.smokePath).toBe('/login')
  })
})

describe('liveProof.smokeContentType', () => {
  it('is optional, so an existing manifest parses and proves text/html as before', () => {
    const outcome = readDeploymentBlock({
      deployment: defaultDeploymentBlock({ appSlug: 'fixture' }),
    })
    expect(outcome.kind).toBe('valid')
    if (outcome.kind !== 'valid') return
    expect(outcome.block.liveProof.smokeContentType).toBeUndefined()
    const flags = parseVerifyArgs([
      '--live',
      'https://app.example',
      ...smokeArgs(outcome.block.liveProof),
    ])
    expect(flags.smokePath).toBe('/')
    expect(flags.expectContentType).toBe('text/html')
  })

  it('asks verify --live for the declared content type on a JSON smoke route', () => {
    const deployment = defaultDeploymentBlock({
      appSlug: 'fixture',
      smokePath: '/api/auth/runtime-public',
    })
    const outcome = readDeploymentBlock({
      deployment: {
        ...deployment,
        liveProof: {
          ...(deployment.liveProof as Record<string, unknown>),
          smokeContentType: 'application/json',
        },
      },
    })
    expect(outcome.kind).toBe('valid')
    if (outcome.kind !== 'valid') return
    expect(smokeArgs(outcome.block.liveProof)).toEqual([
      '--smoke-path',
      '/api/auth/runtime-public',
      '--expect-content-type',
      'application/json',
    ])
    const flags = parseVerifyArgs([
      '--live',
      'https://app.example',
      ...smokeArgs(outcome.block.liveProof),
    ])
    expect(flags.expectContentType).toBe('application/json')
  })
})
