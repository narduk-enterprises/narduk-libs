import { rmSync } from 'node:fs'

import { afterEach, describe, expect, it } from 'vitest'

import { runFoundationCheck } from '../../src/foundation/evaluate.js'
import {
  CONFORMANT_REALITY,
  makeTempRepo,
  subCheckStatus,
  writeConformantBaseline,
  writeFile,
} from './helpers.js'

const tempDirs: string[] = []
afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { force: true, recursive: true })
})

async function run(root: string) {
  return runFoundationCheck({
    root,
    toolVersion: '0.0.0-test',
    reality: CONFORMANT_REALITY,
    appOverrides: { repo: 'x/y', commit: 'a'.repeat(40) },
  })
}

describe('item 6 -- secrets and registry', () => {
  it('6.1 is not-applicable with no .npmrc, fails one carrying an auth line, passes a scope-only one', async () => {
    const root = makeTempRepo()
    tempDirs.push(root)
    writeConformantBaseline(root)
    expect(subCheckStatus(await run(root), '6.1')).toBe('not-applicable')

    writeFile(
      root,
      '.npmrc',
      '@narduk-enterprises:registry=https://npm.pkg.github.com\n//npm.pkg.github.com/:_authToken=ghp_seeded_lie\n',
    )
    const artefact = await run(root)
    expect(subCheckStatus(artefact, '6.1')).toBe('fail')
    // the offending line's content is never echoed into the detail text
    for (const item of artefact.items) {
      for (const sub of item.checks) {
        expect(sub.detail).not.toContain('ghp_seeded_lie')
        expect(sub.evidence ?? '').not.toContain('ghp_seeded_lie')
      }
    }

    writeFile(root, '.npmrc', '@narduk-enterprises:registry=https://npm.pkg.github.com\n')
    expect(subCheckStatus(await run(root), '6.1')).toBe('pass')
  })

  it('6.2 fails a committed .env/.dev.vars, passes without one', async () => {
    const root = makeTempRepo()
    tempDirs.push(root)
    writeConformantBaseline(root)
    expect(subCheckStatus(await run(root), '6.2')).toBe('pass')

    writeFile(root, '.dev.vars', 'SECRET=seeded-lie\n')
    expect(subCheckStatus(await run(root), '6.2')).toBe('fail')

    rmSync(`${root}/.dev.vars`, { force: true })
    expect(subCheckStatus(await run(root), '6.2')).toBe('pass')
  })

  it('6.3 is always not-applicable (nvault paused, D-ORG-1 h)', async () => {
    const root = makeTempRepo()
    tempDirs.push(root)
    writeConformantBaseline(root)
    expect(subCheckStatus(await run(root), '6.3')).toBe('not-applicable')
  })
})
