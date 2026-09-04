import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

/**
 * `useAppFetch()` is consumed from a published package, so a Nuxt
 * auto-import for `useRequestFetch` never resolves at runtime — calling it
 * threw `useRequestFetch is not defined` from app code (narduk-libs#59). The
 * composable must import it explicitly instead of relying on the ambient
 * global, matching the pattern every other composable in this package
 * already uses for `#imports` (see `useColorModeToggle.ts`, pinned by
 * `tests/package-exports.test.ts`).
 *
 * `useAppFetch.ts` isn't in `tsconfig.layer-tooling.json`'s include list (it
 * needs Nuxt's generated `#imports` types, which that narrower project
 * doesn't have), so importing it from a test here would fail `nuxt
 * typecheck` with a TS6307 project-boundary error. Asserting against the
 * source text avoids that while still failing before the fix and passing
 * after it.
 */

const __dirname = dirname(fileURLToPath(import.meta.url))
const useAppFetchSource = readFileSync(
  join(__dirname, '..', 'runtime', 'app', 'composables', 'useAppFetch.ts'),
  'utf-8',
)

describe('useAppFetch', () => {
  it('imports useRequestFetch explicitly instead of relying on the Nuxt auto-import global', () => {
    expect(useAppFetchSource).toContain("import { useRequestFetch } from '#imports'")
  })
})
