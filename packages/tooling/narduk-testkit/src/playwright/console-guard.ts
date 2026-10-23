import { test as base } from '@playwright/test'

import { createConsoleTracker } from './ui-quality.js'

import type {
  Fixtures,
  PlaywrightTestArgs,
  PlaywrightTestOptions,
  PlaywrightWorkerArgs,
  PlaywrightWorkerOptions,
} from '@playwright/test'
import type { ConsoleIgnorePattern, ConsoleTracker, TelemetryMode } from './ui-quality.js'

/**
 * A fixture that fails every test whose page logged `console.error` or threw an
 * uncaught exception, so a regression that only shows in the console cannot
 * pass a suite that never looked there.
 *
 * It is `createConsoleTracker` underneath, so the allowlist, the failed-response
 * correlation and the telemetry stub behave exactly as documented for
 * `playwright/ui-quality`; there is no second matcher to drift.
 *
 * Warnings are not recorded by default: they are advice, and a guard that fails
 * on advice gets switched off. Set `consoleLevels` to `['error', 'warning']`
 * for a suite that wants them.
 *
 * Compose with other fixtures by `mergeTests(test, other)`, or put the guard on
 * your own base with `base.extend<ConsoleGuardTestFixtures>(consoleGuardFixtures)`.
 * It adds a fixture beside `page` rather than overriding `page`, so it does not
 * collide with `e2e/fixtures`, which does.
 */

export interface ConsoleGuardOptions {
  /** Console text this suite has decided is not a defect. Same shape as `ignoredPatterns`. */
  consoleAllowlist: ConsoleIgnorePattern[]
  /** `'stub'` aborts optional-telemetry requests; see `ConsoleTrackerOptions.telemetry`. */
  consoleTelemetry: TelemetryMode
  /** Extra telemetry hosts for `consoleTelemetry: 'stub'`, such as an app's proxied PostHog host. */
  consoleTelemetryHosts: string[]
  /** Console levels that fail the test. `pageerror` always does. */
  consoleLevels: Array<'error' | 'warning'>
}

export interface ConsoleGuardFixtures {
  /** The running tracker, for a test that wants to read `getIssues()` itself. */
  consoleGuard: ConsoleTracker
}

export type ConsoleGuardTestFixtures = ConsoleGuardOptions & ConsoleGuardFixtures

export const consoleGuardFixtures: Fixtures<
  ConsoleGuardTestFixtures,
  {},
  PlaywrightTestArgs & PlaywrightTestOptions,
  PlaywrightWorkerArgs & PlaywrightWorkerOptions
> = {
  consoleAllowlist: [[], { option: true }],
  consoleLevels: [['error'], { option: true }],
  consoleTelemetry: ['live', { option: true }],
  consoleTelemetryHosts: [[], { option: true }],
  consoleGuard: [
    async (
      { consoleAllowlist, consoleLevels, consoleTelemetry, consoleTelemetryHosts, page },
      use,
    ) => {
      const tracker = createConsoleTracker(page, {
        extraTelemetryHosts: consoleTelemetryHosts,
        ignoredPatterns: consoleAllowlist,
        levels: consoleLevels,
        telemetry: consoleTelemetry,
      })
      // Routing must exist before the first navigation or a stubbed run is silently live.
      await tracker.ready

      await use(tracker)

      await tracker.expectClean()
    },
    { auto: true },
  ],
}

export const test = base.extend<ConsoleGuardTestFixtures>(consoleGuardFixtures)

export { expect } from '@playwright/test'
