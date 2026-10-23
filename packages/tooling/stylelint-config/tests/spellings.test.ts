import stylelint from 'stylelint'
import { describe, expect, it } from 'vitest'

import config from '../index.mjs'

async function rules(code: string): Promise<string[]> {
  const result = await stylelint.lint({ code, config })
  return result.results.flatMap((entry) => entry.warnings.map((w) => w.rule))
}

describe('narduk plugin catches every spelling of a banned value', () => {
  it('an uppercase Z-INDEX property', async () => {
    expect(await rules('.a { Z-INDEX: 9 }\n')).toContain('narduk/no-raw-z-index')
  })

  it.each(['620PX', '620.0px', '0620px', '1080px'])('a %s media query', async (width) => {
    expect(await rules(`@media (min-width: ${width}) { a { color: red } }\n`)).toContain(
      'narduk/no-legacy-breakpoints',
    )
  })

  it('does not read .620px as 620px', async () => {
    expect(await rules('@media (min-width: .620px) { a { color: red } }\n')).not.toContain(
      'narduk/no-legacy-breakpoints',
    )
  })
})
