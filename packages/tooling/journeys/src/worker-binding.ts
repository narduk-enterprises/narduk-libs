/**
 * Per-worker `base` / `world` binding for the web adapter (narduk-libs#116).
 *
 * Playwright-free on purpose: the core stays runtime-neutral, and the
 * registered `test()` body is the only place that knows the worker. This
 * module is the contract; `./web` is the place that reads `test.info()`.
 */

export type WorkerResolver<T> = (workerIndex: number) => T
export type WorkerResolved<T> = T | WorkerResolver<T>

export function isWorkerResolver<T>(value: WorkerResolved<T>): value is WorkerResolver<T> {
  return typeof value === 'function'
}

export function resolveWorkerValue<T>(value: WorkerResolved<T>, workerIndex: number): T {
  return isWorkerResolver(value) ? value(workerIndex) : value
}

/**
 * Playwright's worker index, from `test.info().parallelIndex` when the body
 * is running, otherwise `TEST_PARALLEL_INDEX`. Missing both is worker 0 —
 * the serial / `workers: 1` case.
 */
export function workerIndexFrom(
  source: { parallelIndex?: number; env?: NodeJS.ProcessEnv } = {},
): number {
  if (source.parallelIndex !== undefined) {
    return requireNonNegativeInteger('parallelIndex', source.parallelIndex)
  }
  const env = source.env ?? process.env
  const raw = env.TEST_PARALLEL_INDEX
  if (raw === undefined || raw === '') return 0
  return requireNonNegativeInteger('TEST_PARALLEL_INDEX', Number(raw), raw)
}

/**
 * Configured pool size, from `test.info().config.workers` when a test is
 * running, otherwise `TEST_WORKERS`. Playwright does not publish the count
 * at spec-load, so the env form is the registration-time path.
 */
export function configuredWorkersFrom(
  source: { workers?: number; env?: NodeJS.ProcessEnv } = {},
): number | undefined {
  if (source.workers !== undefined) {
    return requireNonNegativeInteger('workers', source.workers)
  }
  const env = source.env ?? process.env
  const raw = env.TEST_WORKERS
  if (raw === undefined || raw === '') return undefined
  const parsed = Number(raw)
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error(`TEST_WORKERS must be a positive integer, got ${JSON.stringify(raw)}`)
  }
  return parsed
}

/**
 * A function `base` AND a function `world` is the only arrangement that
 * permits a worker pool. A scalar of either shares one origin or one
 * database across the pool — the wrong-but-green overwrite the contract
 * exists to kill. `workers` missing or `<= 1` is today's serial case.
 */
export function assertIsolatedTargets(args: {
  base: WorkerResolved<unknown>
  world: WorkerResolved<unknown>
  workers: number | undefined
}): void {
  if (args.workers === undefined || args.workers <= 1) return
  const baseIsFn = isWorkerResolver(args.base)
  const worldIsFn = isWorkerResolver(args.world)
  if (baseIsFn && worldIsFn) return

  const which =
    !baseIsFn && !worldIsFn
      ? 'a scalar base and a scalar world'
      : !baseIsFn
        ? 'a scalar base'
        : 'a scalar world'

  throw new Error(
    `registerJourneys refuses a Playwright worker pool (workers: ${args.workers}) with ` +
      `${which}. A function base and a function world are the only arrangement that ` +
      `isolates origin and database per worker. Sharing one origin and one database ` +
      `across the pool is the wrong-but-green overwrite: two journeys reseeding the ` +
      `same world at once. Parallelism is legitimate only across isolated targets.`,
  )
}

export function bindWorkerTargets<B, W>(
  options: { base: WorkerResolved<B>; world: WorkerResolved<W> },
  source: { workers?: number; parallelIndex?: number; env?: NodeJS.ProcessEnv } = {},
): { base: B; world: W; workerIndex: number } {
  assertIsolatedTargets({
    base: options.base,
    world: options.world,
    workers: configuredWorkersFrom(source),
  })
  const workerIndex = workerIndexFrom(source)
  return {
    base: resolveWorkerValue(options.base, workerIndex),
    world: resolveWorkerValue(options.world, workerIndex),
    workerIndex,
  }
}

function requireNonNegativeInteger(name: string, value: number, raw: unknown = value): number {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`${name} must be a non-negative integer, got ${JSON.stringify(raw)}`)
  }
  return value
}
