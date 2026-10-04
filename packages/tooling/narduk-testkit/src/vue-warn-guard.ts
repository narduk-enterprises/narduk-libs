/**
 * Make a Vue warning fail the unit test that caused it (narduk-libs#1403).
 *
 * Vue renders an unresolved component as an unknown custom element, an
 * un-provided `inject()` as `undefined`, and a component with no template as an
 * empty comment -- each with a `[Vue warn]` line on `console.warn` and nothing
 * else. A unit test that mounts such a tree stays green while asserting against
 * markup the app never ships, and a negative assertion (`not.toContain`,
 * `toHaveLength(0)`) cannot fail at all. The warning is the only evidence, so
 * it has to be able to fail the run.
 *
 * Call {@link installVueWarnGuard} once from a Vitest `setupFiles` entry:
 *
 * ```ts
 * // test/support/setup.ts
 * import { installVueWarnGuard } from '@narduk-enterprises/narduk-testkit/vue-warn-guard'
 *
 * installVueWarnGuard()
 * ```
 *
 * Every test then fails in `afterEach` if Vue warned while it ran. The warning
 * is still forwarded to the real `console.warn`, so the output names the
 * component trace as before. A warning a single test allows on purpose
 * ({@link allowVueWarning}) is not printed; a suite-wide allowance still is.
 *
 * Why not throw from `console.warn` itself: Vue calls it from inside a render
 * or watcher, where its own error handling swallows the throw and logs
 * "Unhandled error during execution of ..." instead, which turns one defect
 * into two and can leave the test passing. Recording and failing in
 * `afterEach` cannot be swallowed.
 *
 * A warning that must stay is allowed with a `reason`, either for a whole
 * suite (`allow` here) or for one test ({@link allowVueWarning}). The reason is
 * required and reviewed like any other suppression; an allowance that matches
 * nothing in a run is reported by {@link VueWarnGuard.unusedAllowances} so a
 * ratchet can only shrink.
 */
import { afterAll, afterEach, beforeEach, expect } from 'vitest'

/** A Vue warning that is allowed to pass, and why. */
export interface VueWarnAllowance {
  /** Matched against the full warning text, including Vue's component trace. */
  match: RegExp
  /** Why this warning is not a defect. Required: an unexplained allowance is a bug hiding. */
  reason: string
}

export interface VueWarnGuardOptions {
  /** Suite-wide allowances. Keep this list short and shrinking. */
  allow?: readonly VueWarnAllowance[]
}

export interface VueWarnGuard {
  /** Warnings recorded since the last test finished, as `{ test, text }`. */
  readonly pending: ReadonlyArray<{ test: string; text: string }>
  /** Suite-wide allowances that matched no warning so far. */
  unusedAllowances(): VueWarnAllowance[]
}

const VUE_WARN = /\[Vue warn\]/
const GUARD = Symbol.for('narduk-testkit.vue-warn-guard')

interface GuardState extends VueWarnGuard {
  testAllowances: VueWarnAllowance[]
  used: Set<VueWarnAllowance>
  suiteAllowances: readonly VueWarnAllowance[]
  recorded: Array<{ test: string; text: string }>
}

function stateOf(): GuardState | undefined {
  return (globalThis as Record<symbol, GuardState | undefined>)[GUARD]
}

function assertReasons(allowances: readonly VueWarnAllowance[]) {
  for (const allowance of allowances) {
    if (!allowance.reason || allowance.reason.trim().length < 10) {
      throw new Error(
        `A Vue warning allowance needs a reason of at least a sentence fragment (${String(allowance.match)})`,
      )
    }
  }
}

function render(args: unknown[]): string {
  return args.map((value) => (typeof value === 'string' ? value : safeInspect(value))).join(' ')
}

function safeInspect(value: unknown): string {
  try {
    return typeof value === 'object' ? JSON.stringify(value) : String(value)
  } catch {
    return String(value)
  }
}

export function installVueWarnGuard(options: VueWarnGuardOptions = {}): VueWarnGuard {
  const existing = stateOf()
  if (existing) return existing

  const suiteAllowances = options.allow ?? []
  assertReasons(suiteAllowances)

  const state: GuardState = {
    recorded: [],
    suiteAllowances,
    testAllowances: [],
    used: new Set(),
    get pending() {
      return state.recorded
    },
    unusedAllowances() {
      return suiteAllowances.filter((allowance) => !state.used.has(allowance))
    },
  }
  ;(globalThis as Record<symbol, GuardState>)[GUARD] = state

  const original = console.warn.bind(console)
  console.warn = (...args: unknown[]) => {
    const text = render(args)
    if (VUE_WARN.test(text)) {
      const suite = state.suiteAllowances.find((candidate) => candidate.match.test(text))
      const test = state.testAllowances.find((candidate) => candidate.match.test(text))
      const allowance = test ?? suite
      if (allowance) state.used.add(allowance)
      else {
        state.recorded.push({ test: expect.getState().currentTestName ?? '(outside a test)', text })
      }
      // A test that provokes the warning on purpose has nothing to report, so
      // its output stays clean. A suite-wide allowance is known debt: it keeps
      // printing, so the ratchet stays visible in the log.
      if (test) return
    }
    original(...args)
  }

  const flush = (where: string) => {
    state.testAllowances = []
    if (state.recorded.length === 0) return
    const warnings = state.recorded.splice(0)
    const unique = [...new Set(warnings.map(({ text }) => firstLine(text)))]
    throw new Error(
      [
        `Vue warned ${warnings.length} time(s) ${where}; a unit test must not pass over a Vue warning (narduk-libs#1403).`,
        'Register the component the test mounts (see @narduk-enterprises/narduk-testkit/vue-test-env), fix the component, or allow the warning with a reason.',
        ...unique.map((line) => `  - ${line}`),
      ].join('\n'),
    )
  }

  beforeEach(() => {
    state.recorded.length = 0
    state.testAllowances = []
  })
  afterEach(() => flush('during this test'))
  afterAll(() => flush('outside a test (module scope, beforeAll or afterAll)'))

  return state
}

function firstLine(text: string): string {
  return text.split('\n')[0]!.trim().slice(0, 240)
}

/**
 * Allow a Vue warning for the current test only. Use it for a test that
 * exists to provoke the warning; the allowance is dropped when the test ends.
 */
export function allowVueWarning(match: RegExp, reason: string): void {
  const state = stateOf()
  if (!state) {
    throw new Error('allowVueWarning() needs installVueWarnGuard() in a Vitest setup file')
  }
  const allowance = { match, reason }
  assertReasons([allowance])
  state.testAllowances.push(allowance)
}
