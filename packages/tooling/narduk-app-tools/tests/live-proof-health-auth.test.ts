import { describe, expect, it } from 'vitest'

import {
  defaultDeploymentBlock,
  healthArgs,
  readDeploymentBlock,
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
