import { afterEach, describe, expect, it } from 'vitest'

import {
  assertIsolatedTargets,
  bindWorkerTargets,
  configuredWorkersFrom,
  isWorkerResolver,
  resolveWorkerValue,
  workerIndexFrom,
} from '../src/worker-binding.js'

const originalWorkers = process.env.TEST_WORKERS
const originalIndex = process.env.TEST_PARALLEL_INDEX

afterEach(() => {
  if (originalWorkers === undefined) delete process.env.TEST_WORKERS
  else process.env.TEST_WORKERS = originalWorkers
  if (originalIndex === undefined) delete process.env.TEST_PARALLEL_INDEX
  else process.env.TEST_PARALLEL_INDEX = originalIndex
})

const scalarWorld = { id: 'shared' }
const worldFor = (workerIndex: number) => ({ id: `world-${workerIndex}` })
const baseFor = (workerIndex: number) => `http://localhost:${3241 + workerIndex}`

describe('isWorkerResolver / resolveWorkerValue', () => {
  it('treats a function as a per-worker resolver and a scalar as itself', () => {
    expect(isWorkerResolver(baseFor)).toBe(true)
    expect(isWorkerResolver('http://localhost:3241')).toBe(false)
    expect(isWorkerResolver(scalarWorld)).toBe(false)
    expect(resolveWorkerValue('http://localhost:3241', 3)).toBe('http://localhost:3241')
    expect(resolveWorkerValue(baseFor, 3)).toBe('http://localhost:3244')
  })
})

describe('workerIndexFrom', () => {
  it('prefers parallelIndex, then TEST_PARALLEL_INDEX, then worker 0', () => {
    expect(workerIndexFrom({ parallelIndex: 2, env: { TEST_PARALLEL_INDEX: '9' } })).toBe(2)
    expect(workerIndexFrom({ env: { TEST_PARALLEL_INDEX: '3' } })).toBe(3)
    expect(workerIndexFrom({ env: {} })).toBe(0)
    process.env.TEST_PARALLEL_INDEX = '4'
    expect(workerIndexFrom()).toBe(4)
  })

  it('refuses a negative or non-integer index', () => {
    expect(() => workerIndexFrom({ parallelIndex: -1 })).toThrow(/parallelIndex/)
    expect(() => workerIndexFrom({ env: { TEST_PARALLEL_INDEX: 'nope' } })).toThrow(
      /TEST_PARALLEL_INDEX/,
    )
  })
})

describe('configuredWorkersFrom', () => {
  it('prefers an explicit workers count, then TEST_WORKERS, else unknown', () => {
    expect(configuredWorkersFrom({ workers: 4, env: { TEST_WORKERS: '9' } })).toBe(4)
    expect(configuredWorkersFrom({ env: { TEST_WORKERS: '3' } })).toBe(3)
    expect(configuredWorkersFrom({ env: {} })).toBeUndefined()
    process.env.TEST_WORKERS = '2'
    expect(configuredWorkersFrom()).toBe(2)
  })

  it('refuses a non-positive TEST_WORKERS', () => {
    expect(() => configuredWorkersFrom({ env: { TEST_WORKERS: '0' } })).toThrow(/TEST_WORKERS/)
    expect(() => configuredWorkersFrom({ env: { TEST_WORKERS: '1.5' } })).toThrow(/TEST_WORKERS/)
  })
})

describe('assertIsolatedTargets', () => {
  it("allows today's scalars when the pool is serial or unknown", () => {
    expect(() =>
      assertIsolatedTargets({ base: 'http://localhost:3241', world: scalarWorld, workers: 1 }),
    ).not.toThrow()
    expect(() =>
      assertIsolatedTargets({
        base: 'http://localhost:3241',
        world: scalarWorld,
        workers: undefined,
      }),
    ).not.toThrow()
  })

  it('allows a function pair against a worker pool', () => {
    expect(() =>
      assertIsolatedTargets({ base: baseFor, world: worldFor, workers: 4 }),
    ).not.toThrow()
  })

  it('refuses a scalar base or world against a worker pool, naming the overwrite', () => {
    const shared = /one origin and one database[\s\S]*wrong-but-green overwrite/
    expect(() =>
      assertIsolatedTargets({ base: 'http://localhost:3241', world: scalarWorld, workers: 4 }),
    ).toThrow(shared)
    expect(() =>
      assertIsolatedTargets({ base: 'http://localhost:3241', world: scalarWorld, workers: 4 }),
    ).toThrow(/scalar base and a scalar world/)
    expect(() =>
      assertIsolatedTargets({ base: 'http://localhost:3241', world: worldFor, workers: 4 }),
    ).toThrow(/scalar base/)
    expect(() => assertIsolatedTargets({ base: baseFor, world: scalarWorld, workers: 4 })).toThrow(
      /scalar world/,
    )
  })
})

describe('bindWorkerTargets', () => {
  it('resolves each worker onto its own origin and world', () => {
    const bound = bindWorkerTargets(
      { base: baseFor, world: worldFor },
      { workers: 4, parallelIndex: 2 },
    )
    expect(bound.workerIndex).toBe(2)
    expect(bound.base).toBe('http://localhost:3243')
    expect(bound.world).toEqual({ id: 'world-2' })
  })

  it('keeps a scalar pair as-is for workers: 1', () => {
    const bound = bindWorkerTargets(
      { base: 'http://localhost:3241', world: scalarWorld },
      { workers: 1, parallelIndex: 0 },
    )
    expect(bound).toEqual({
      base: 'http://localhost:3241',
      world: scalarWorld,
      workerIndex: 0,
    })
  })

  it('refuses to bind a shared target onto a pool', () => {
    expect(() =>
      bindWorkerTargets(
        { base: 'http://localhost:3241', world: worldFor },
        { workers: 4, parallelIndex: 1 },
      ),
    ).toThrow(/scalar base/)
  })
})
