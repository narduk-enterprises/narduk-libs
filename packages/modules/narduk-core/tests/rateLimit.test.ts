import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

/**
 * `showcaseAuthLoginTest` guarded a `/api/auth/login-test` endpoint that
 * never existed in this repo; its only consumer,
 * `useAuthApi().loginAsTestUser()`, was removed from narduk-auth in the
 * correctness-pass PR. Keeping the policy on this published surface with
 * zero consumers and zero behavioral gain is what narduk-libs#96 flagged.
 *
 * `RATE_LIMIT_POLICIES` itself imports `nitropack/runtime`, which only
 * resolves inside the full Nuxt app typecheck project — not the narrower
 * `tsconfig.layer-tooling.json` project this package's `tests/**` glob
 * belongs to. Asserting against the source text (the same pattern
 * `tests/package-exports.test.ts` uses for `useColorModeToggle.ts`'s
 * explicit `#imports`) avoids importing the module from a test file and
 * tripping a TS6307 project-boundary error.
 */

const __dirname = dirname(fileURLToPath(import.meta.url))
const rateLimitSource = readFileSync(
  join(__dirname, '..', 'runtime', 'server', 'utils', 'rateLimit.ts'),
  'utf-8',
)

describe('RATE_LIMIT_POLICIES', () => {
  it('does not declare the orphaned showcaseAuthLoginTest policy', () => {
    expect(rateLimitSource).not.toContain('showcaseAuthLoginTest')
  })

  it('still declares the policies that remain in active use', () => {
    expect(rateLimitSource).toContain(
      "showcaseAuthLogin: defineRateLimitPolicy('showcaseAuthLogin'",
    )
    expect(rateLimitSource).toContain("mapkitToken: defineRateLimitPolicy('mapkitToken'")
  })
})
