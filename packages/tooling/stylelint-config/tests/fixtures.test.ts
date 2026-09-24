import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import stylelint from 'stylelint'
import { describe, expect, it } from 'vitest'

import config from '../index.mjs'

const here = dirname(fileURLToPath(import.meta.url))

async function lint(file: string) {
  return stylelint.lint({
    files: join(here, 'fixtures', file),
    config,
  })
}

function ruleNames(result: Awaited<ReturnType<typeof stylelint.lint>>) {
  return result.results.flatMap((entry) => entry.warnings.map((warning) => warning.rule)).sort()
}

describe('stylelint fixtures (narduk-libs#535)', () => {
  it('warns on a raw z-index', async () => {
    const result = await lint('raw-z-index.css')
    expect(ruleNames(result)).toEqual(['narduk/no-raw-z-index'])
  })

  it('warns on the 620/820/1080 media scale', async () => {
    const result = await lint('legacy-breakpoint.css')
    expect(ruleNames(result)).toEqual([
      'media-feature-name-value-allowed-list',
      'narduk/no-legacy-breakpoints',
    ])
  })

  it('warns on a --bs token that is not a --ns alias', async () => {
    const result = await lint('bs-literal.css')
    expect(ruleNames(result)).toEqual(['narduk/bs-alias-only'])
  })

  it('accepts --ns-z-*, 40rem media, and --bs aliases', async () => {
    const result = await lint('ok.css')
    expect(ruleNames(result)).toEqual([])
  })
})
