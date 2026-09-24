// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'

import { knownTextMismatchWarnings } from './hydration-warnings'

describe('hydration warning spy', () => {
  it('sees Vue 3.5 warn and the once-per-process mismatch error', async () => {
    const warnings = await knownTextMismatchWarnings()
    expect(
      warnings.some(
        line => line.includes('[Vue warn]') && line.includes('Hydration text content mismatch'),
      ),
    ).toBe(true)
    expect(
      warnings.some(line => line.includes('Hydration completed but contains mismatches.')),
    ).toBe(true)
  })
})
