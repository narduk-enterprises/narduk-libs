import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

function sourceFiles(root: string): string[] {
  return readdirSync(root).flatMap((name) => {
    const path = join(root, name)
    return statSync(path).isDirectory() ? sourceFiles(path) : path.endsWith('.ts') ? [path] : []
  })
}

describe('package boundary', () => {
  it('has no source-level references to retired control surfaces', () => {
    const source = sourceFiles(join(import.meta.dirname, '..', 'src'))
      .map((path) => readFileSync(path, 'utf8'))
      .join('\n')
    expect(source).not.toMatch(/narduk-fleet|reconcile|drift|sync-wrangler/iu)
    expect(source).not.toMatch(
      /\.template-(?:reference|version)|narduk\.layout\.json|provision\.json/iu,
    )
    expect(source).not.toMatch(/guardrail exception|template ref/iu)
  })
})
