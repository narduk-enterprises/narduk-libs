import { describe, expect, it } from 'vitest'

import { ENV_CATALOG } from '../src/env-catalog'
import { normalizeAppEnvContractDefinition } from '../src/provision-env-contract'

describe('ponytail-5 #4 generated signing keys must be per-app', () => {
  it('no minted secret has a value shared across apps', () => {
    const shared = ENV_CATALOG.filter(
      (entry) => entry.from.startsWith('generate:') && entry.secret && entry.scope === 'every-app',
    ).map((entry) => entry.key)
    expect(shared).toEqual([])
  })
})

describe('ponytail-5 #5 catalog secret stored as a plain var', () => {
  for (const key of ['NUXT_SESSION_PASSWORD', 'CRON_SECRET']) {
    it(`rejects ${key} declared plain / runtime-var`, () => {
      const result = normalizeAppEnvContractDefinition({
        version: 1,
        requirements: [
          {
            key,
            managedBy: 'app',
            phase: 'runtime',
            sensitivity: 'plain',
            canonicalProvider: 'cloudflare',
            cloudflarePlanes: ['runtime-var'],
          },
        ],
      })
      expect(result).toBeNull()
    })
  }
})
