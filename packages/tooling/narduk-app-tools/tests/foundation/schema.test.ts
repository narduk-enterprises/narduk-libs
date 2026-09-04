import { rmSync } from 'node:fs'

import { afterEach, describe, expect, it } from 'vitest'

import { runFoundationCheck } from '../../src/foundation/evaluate.js'
import { buildArtefact, check, itemResult, rollUp } from '../../src/foundation/schema.js'
import { CONFORMANT_REALITY, makeTempRepo, writeConformantBaseline } from './helpers.js'

const tempDirs: string[] = []
afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { force: true, recursive: true })
})

describe('rollUp', () => {
  it('fail beats unknown beats pass', () => {
    expect(
      rollUp([
        check('a', 'a', 'pass', 'x'),
        check('b', 'b', 'unknown', 'x'),
        check('c', 'c', 'fail', 'x'),
      ]),
    ).toBe('fail')
    expect(rollUp([check('a', 'a', 'pass', 'x'), check('b', 'b', 'unknown', 'x')])).toBe('unknown')
  })

  it('unknown is never a pass, even alone', () => {
    expect(rollUp([check('a', 'a', 'unknown', 'x')])).toBe('unknown')
  })

  it('all-not-applicable rolls up to not-applicable', () => {
    expect(
      rollUp([check('a', 'a', 'not-applicable', 'x'), check('b', 'b', 'not-applicable', 'x')]),
    ).toBe('not-applicable')
  })

  it('a single not-applicable next to a pass rolls up to pass, not not-applicable', () => {
    expect(rollUp([check('a', 'a', 'not-applicable', 'x'), check('b', 'b', 'pass', 'x')])).toBe(
      'pass',
    )
  })

  it('an empty sub-check list is unknown, never a silent pass', () => {
    expect(rollUp([])).toBe('unknown')
  })
})

describe('buildArtefact', () => {
  const baseApp = {
    repo: 'narduk-enterprises/fixture-app',
    name: 'fixture-app',
    commit: 'a'.repeat(40),
    ref: 'refs/heads/main',
  }

  function itemsWith(seventhStatus: 'not-applicable' | 'pass' | 'fail' | 'unknown') {
    const items = [1, 2, 3, 4, 5, 6].map((id) =>
      itemResult(id, [check(`${id}.0`, 'x', 'pass', 'ok')]),
    )
    items.push(itemResult(7, [check('7.0', 'recorded exemption', seventhStatus, 'x')]))
    return items
  }

  it('throws if item 7 is anything but not-applicable -- the F3 invariant is enforced at build time, not just by convention', () => {
    expect(() =>
      buildArtefact({ toolVersion: '0.0.0-test', app: baseApp, items: itemsWith('pass') }),
    ).toThrow(/item 7/)
    expect(() =>
      buildArtefact({ toolVersion: '0.0.0-test', app: baseApp, items: itemsWith('fail') }),
    ).toThrow(/item 7/)
    expect(() =>
      buildArtefact({ toolVersion: '0.0.0-test', app: baseApp, items: itemsWith('unknown') }),
    ).toThrow(/item 7/)
    expect(() =>
      buildArtefact({
        toolVersion: '0.0.0-test',
        app: baseApp,
        items: itemsWith('not-applicable'),
      }),
    ).not.toThrow()
  })

  it('throws if fewer or more than exactly items 1..7 are supplied', () => {
    const items = itemsWith('not-applicable').slice(0, 6)
    expect(() => buildArtefact({ toolVersion: '0.0.0-test', app: baseApp, items })).toThrow(
      /exactly items 1\.\.7/,
    )
  })

  it('maps to exit code 0/PASS, 1/FAIL, 2/UNKNOWN', () => {
    const passing = buildArtefact({
      toolVersion: '0.0.0-test',
      app: baseApp,
      items: itemsWith('not-applicable'),
    })
    expect(passing.result).toBe('PASS')
    expect(passing.exitCode).toBe(0)

    const withFail = [
      itemResult(1, [check('1.0', 'x', 'fail', 'seeded lie')]),
      ...itemsWith('not-applicable').slice(1),
    ]
    const failing = buildArtefact({ toolVersion: '0.0.0-test', app: baseApp, items: withFail })
    expect(failing.result).toBe('FAIL')
    expect(failing.exitCode).toBe(1)
    expect(failing.failingItems).toContain(1)

    const withUnknown = [
      itemResult(1, [check('1.0', 'x', 'unknown', 'seeded lie')]),
      ...itemsWith('not-applicable').slice(1),
    ]
    const unknown = buildArtefact({ toolVersion: '0.0.0-test', app: baseApp, items: withUnknown })
    expect(unknown.result).toBe('UNKNOWN')
    expect(unknown.exitCode).toBe(2)
  })

  it('a fail is never erased by an undecided sibling at the artefact level either', () => {
    const items = [
      itemResult(1, [check('1.0', 'x', 'fail', 'seeded lie'), check('1.1', 'x', 'unknown', 'y')]),
      ...itemsWith('not-applicable').slice(1),
    ]
    const artefact = buildArtefact({ toolVersion: '0.0.0-test', app: baseApp, items })
    expect(artefact.result).toBe('FAIL')
  })
})

describe('end-to-end artefact shape (mirrors check-web-foundation.py validate_artefact())', () => {
  it('a real run against the conformant baseline satisfies every rollup-side validation rule', async () => {
    const root = makeTempRepo()
    tempDirs.push(root)
    writeConformantBaseline(root)
    const artefact = await runFoundationCheck({
      root,
      toolVersion: '1.2.3',
      reality: CONFORMANT_REALITY,
      appOverrides: { repo: 'narduk-enterprises/fixture-app', commit: 'b'.repeat(40) },
    })

    expect(artefact.schemaVersion).toBe(1)
    expect(artefact.app.repo).toMatch(/^[\w.-]+\/[\w.-]+$/)
    expect(artefact.app.commit).toMatch(/^[0-9a-f]{40}$/)
    expect(artefact.items).toHaveLength(7)
    expect(artefact.items.map((it) => it.id)).toEqual([1, 2, 3, 4, 5, 6, 7])
    for (const item of artefact.items) {
      expect(['pass', 'fail', 'unknown', 'not-applicable']).toContain(item.status)
    }
    expect(artefact.items.find((it) => it.id === 7)?.status).toBe('not-applicable')
    expect(['PASS', 'FAIL', 'UNKNOWN']).toContain(artefact.result)
    expect(artefact.result).toBe('PASS')
    expect(artefact.exitCode).toBe(0)
  })
})
