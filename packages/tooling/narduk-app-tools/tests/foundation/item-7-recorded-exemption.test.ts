import { rmSync } from 'node:fs'

import { afterEach, describe, expect, it } from 'vitest'

import { runFoundationCheck } from '../../src/foundation/evaluate.js'
import { evaluateItem7 } from '../../src/foundation/items/item-7-recorded-exemption.js'
import {
  CONFORMANT_REALITY,
  makeTempRepo,
  itemStatus,
  subCheckStatus,
  writeConformantBaseline,
} from './helpers.js'

const tempDirs: string[] = []
afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { force: true, recursive: true })
})

describe('item 7 -- recorded exemption', () => {
  it('always resolves to not-applicable, with no inputs at all', () => {
    const checks = evaluateItem7()
    expect(checks).toHaveLength(1)
    expect(checks[0].status).toBe('not-applicable')
    expect(checks[0].id).toBe('7.0')
  })

  it('is not-applicable end-to-end regardless of app state', async () => {
    const root = makeTempRepo()
    tempDirs.push(root)
    writeConformantBaseline(root)
    const artefact = await runFoundationCheck({
      root,
      toolVersion: '0.0.0-test',
      reality: CONFORMANT_REALITY,
      appOverrides: { repo: 'x/y', commit: 'a'.repeat(40) },
    })
    expect(itemStatus(artefact, 7)).toBe('not-applicable')
    expect(subCheckStatus(artefact, '7.0')).toBe('not-applicable')
  })
})
