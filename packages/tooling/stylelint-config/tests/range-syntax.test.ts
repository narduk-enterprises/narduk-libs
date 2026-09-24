import stylelint from 'stylelint'
import { describe, expect, it } from 'vitest'

/**
 * Phase 1c: verify `media-feature-name-value-allowed-list` against range
 * syntax before relying on it. Stylelint 16 does populate `width` from
 * `@media (width < 40rem)`, so the allowed-list can gate Tailwind rem
 * breakpoints. The narduk plugin still names the retired 620/820/1080 scale.
 */
describe('media-feature-name-value-allowed-list vs range syntax', () => {
  it('sees width values in `@media (width < 40rem)`', async () => {
    const result = await stylelint.lint({
      code: '@media (width < 40rem) { a { color: red; } }\n',
      config: {
        rules: {
          'media-feature-name-value-allowed-list': {
            width: ['64rem'],
          },
        },
      },
    })
    expect(result.results[0]?.warnings.map((warning) => warning.rule)).toEqual([
      'media-feature-name-value-allowed-list',
    ])
  })
})
