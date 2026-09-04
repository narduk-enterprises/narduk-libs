import { describe, expect, it } from 'vitest'

interface AppSmokeTestOptions {
  describeName?: string
}

/**
 * Baseline vitest smoke block used by every fleet app to prove that the
 * server test runner is wired up. Apps replace their hand-rolled
 * `tests/server/smoke.test.ts` body with a single factory call:
 *
 *   import { registerAppSmokeTests } from '@narduk-enterprises/narduk-testkit/server/kit/smoke'
 *   registerAppSmokeTests()
 */
export function registerAppSmokeTests(options: AppSmokeTestOptions = {}) {
  const { describeName = 'apps/web unit tests' } = options

  describe(describeName, () => {
    it('runs vitest for server-side checks', () => {
      expect(true).toBe(true)
    })
  })
}
