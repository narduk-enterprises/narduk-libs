import { afterEach, describe, expect, it } from 'vitest'

import type { RegisterJourneysOptions } from '../src/web.js'
import { registerJourneys } from '../src/web.js'
import type { WorldHooks } from '../src/types.js'
import { catalog } from './helpers.js'

const originalWorkers = process.env.TEST_WORKERS

afterEach(() => {
  if (originalWorkers === undefined) delete process.env.TEST_WORKERS
  else process.env.TEST_WORKERS = originalWorkers
})

const world: WorldHooks = {
  prepare: async (scenarioId) => ({ scenarioId, generation: 'g1' }),
  generation: async () => 'g1',
  appRevision: async () => 'r1',
}

function options(overrides: Partial<RegisterJourneysOptions> = {}): RegisterJourneysOptions {
  return {
    catalog: catalog(),
    world,
    base: 'http://localhost:3241',
    outRoot: '/tmp/journeys-out',
    environment: 'test',
    profileName: 'desktop',
    declarationDigest: 'sha256:test',
    ...overrides,
  }
}

describe('registerJourneys worker binding', () => {
  it('refuses a scalar base/world at registration when TEST_WORKERS > 1', () => {
    process.env.TEST_WORKERS = '4'
    expect(() => registerJourneys(options())).toThrow(/wrong-but-green overwrite/)
    expect(() => registerJourneys(options({ world: () => world }))).toThrow(/scalar base/)
    expect(() =>
      registerJourneys(options({ base: (index) => `http://localhost:${3241 + index}` })),
    ).toThrow(/scalar world/)
  })

  it('registers a function pair against a worker pool', () => {
    process.env.TEST_WORKERS = '4'
    expect(() =>
      registerJourneys(
        options({
          base: (index) => `http://localhost:${3241 + index}`,
          world: () => world,
          only: [],
        }),
      ),
    ).not.toThrow()
  })

  it('still registers today\'s scalars when the pool is serial', () => {
    delete process.env.TEST_WORKERS
    expect(() => registerJourneys(options({ only: [] }))).not.toThrow()
  })
})
