import { describe, expect, it } from 'vitest'

import { defaultDeploymentBlock, readDeploymentBlock } from '../src/deployment-config.js'

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
