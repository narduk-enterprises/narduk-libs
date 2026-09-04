import { rmSync } from 'node:fs'

import { afterEach, describe, expect, it } from 'vitest'

import { runFoundationCheck } from '../../src/foundation/evaluate.js'
import {
  fakeReality,
  makeTempRepo,
  subCheckStatus,
  writeConformantBaseline,
  writeJson,
} from './helpers.js'

const tempDirs: string[] = []
afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { force: true, recursive: true })
})

const REALITY = fakeReality({
  installed: {
    '@narduk-enterprises/narduk-core': { version: '3.4.1', major: 3, source: 'manifest-pin' },
    '@narduk-enterprises/eslint-config': { version: '2.0.0', major: 2, source: 'manifest-pin' },
  },
  latestMajors: { '@narduk-enterprises/narduk-core': 3 },
})

async function run(root: string, reality = REALITY) {
  return runFoundationCheck({
    root,
    toolVersion: '0.0.0-test',
    reality,
    appOverrides: { repo: 'x/y', commit: 'a'.repeat(40) },
  })
}

describe('item 2 -- mandatory packages', () => {
  it('2.1 fails when a mandatory package is missing, passes with all four', async () => {
    const root = makeTempRepo()
    tempDirs.push(root)
    writeConformantBaseline(root)
    writeJson(root, 'package.json', {
      name: 'x',
      dependencies: { '@narduk-enterprises/narduk-core': '3.4.1' },
    })
    expect(subCheckStatus(await run(root), '2.1')).toBe('fail')

    writeConformantBaseline(root)
    expect(subCheckStatus(await run(root), '2.1')).toBe('pass')
  })

  it('2.2 fails a non-exact pin, passes an exact one', async () => {
    const root = makeTempRepo()
    tempDirs.push(root)
    writeConformantBaseline(root)
    writeJson(root, 'package.json', {
      name: 'x',
      scripts: { 'manifests:validate': 'true' },
      dependencies: {
        '@narduk-enterprises/narduk-core': '^3.4.1',
        '@narduk-enterprises/narduk-testkit': '2.0.0',
        '@narduk-enterprises/narduk-app-tools': '0.1.3',
        '@narduk-enterprises/eslint-config': '2.0.0',
      },
    })
    expect(subCheckStatus(await run(root), '2.2')).toBe('fail')

    writeConformantBaseline(root)
    expect(subCheckStatus(await run(root), '2.2')).toBe('pass')
  })

  it('2.3 (N-1 window) is unknown with no registry read, fails outside the window, passes inside it', async () => {
    const root = makeTempRepo()
    tempDirs.push(root)
    writeConformantBaseline(root)

    expect(subCheckStatus(await run(root, fakeReality()), '2.3')).toBe('unknown')

    const tooOld = fakeReality({
      installed: {
        '@narduk-enterprises/narduk-core': { version: '1.0.0', major: 1, source: 'manifest-pin' },
      },
      latestMajors: { '@narduk-enterprises/narduk-core': 5 },
    })
    expect(subCheckStatus(await run(root, tooOld), '2.3')).toBe('fail')

    const withinWindow = fakeReality({
      installed: {
        '@narduk-enterprises/narduk-core': { version: '4.0.0', major: 4, source: 'manifest-pin' },
      },
      latestMajors: { '@narduk-enterprises/narduk-core': 5 },
    })
    expect(subCheckStatus(await run(root, withinWindow), '2.3')).toBe('pass')
  })

  it('2.4 fails a workspace: specifier on an estate package, passes a registry-resolvable one', async () => {
    const root = makeTempRepo()
    tempDirs.push(root)
    writeConformantBaseline(root)
    writeJson(root, 'package.json', {
      name: 'x',
      scripts: { 'manifests:validate': 'true' },
      dependencies: {
        '@narduk-enterprises/narduk-core': '3.4.1',
        '@narduk-enterprises/narduk-testkit': 'workspace:*',
        '@narduk-enterprises/narduk-app-tools': '0.1.3',
        '@narduk-enterprises/eslint-config': '2.0.0',
      },
    })
    expect(subCheckStatus(await run(root), '2.4')).toBe('fail')

    writeConformantBaseline(root)
    expect(subCheckStatus(await run(root), '2.4')).toBe('pass')
  })

  it('P7: eslint-config major must resolve to >= 2', async () => {
    const root = makeTempRepo()
    tempDirs.push(root)
    writeConformantBaseline(root)

    const majorOne = fakeReality({
      installed: {
        '@narduk-enterprises/narduk-core': { version: '3.4.1', major: 3, source: 'manifest-pin' },
        '@narduk-enterprises/eslint-config': { version: '1.9.0', major: 1, source: 'manifest-pin' },
      },
      latestMajors: { '@narduk-enterprises/narduk-core': 3 },
    })
    expect(subCheckStatus(await run(root, majorOne), '2.1b')).toBe('fail')
    expect(subCheckStatus(await run(root, REALITY), '2.1b')).toBe('pass')
  })
})
