import { rmSync } from 'node:fs'

import { afterEach, describe, expect, it } from 'vitest'

import { normalizedContentHash } from '../../src/foundation/content-hash.js'
import { evaluateItem4 } from '../../src/foundation/items/item-4-no-forks.js'
import { AppRepo } from '../../src/foundation/source.js'
import type { Wave1ForkEntry } from '../../src/foundation/wave1-file-list.js'
import { makeTempRepo, writeConformantBaseline, writeFile, writeJson } from './helpers.js'

const tempDirs: string[] = []
afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { force: true, recursive: true })
})

function statusOf(id: string, checks: ReturnType<typeof evaluateItem4>) {
  const found = checks.find((c) => c.id === id)
  if (!found) throw new Error(`no sub-check ${id}`)
  return found.status
}

describe('item 4 -- no forks of package-owned behaviour', () => {
  it('4.1 fails a template-layer dependency, passes without one', () => {
    const root = makeTempRepo()
    tempDirs.push(root)
    writeConformantBaseline(root)
    writeJson(root, 'package.json', {
      name: 'x',
      scripts: { 'manifests:validate': 'true' },
      dependencies: { '@narduk-enterprises/narduk-nuxt-template-layer-core': '1.0.0' },
    })
    expect(statusOf('4.1', evaluateItem4(new AppRepo(root)))).toBe('fail')

    writeConformantBaseline(root)
    expect(statusOf('4.1', evaluateItem4(new AppRepo(root)))).toBe('pass')
  })

  it('4.2 flags a file whose normalised content matches a known fork fingerprint, and clears once it is removed', () => {
    const root = makeTempRepo()
    tempDirs.push(root)
    writeConformantBaseline(root)

    const forkedContent = '#!/usr/bin/env node\nconsole.log("vendored narduk-toolchain wrapper")\n'
    const seededForkList: Wave1ForkEntry[] = [
      {
        id: 'test-seeded-fork',
        description: 'a synthetic fixture standing in for a real #76 Wave-1 fork',
        ownedBy: '@narduk-enterprises/narduk-app-tools (test)',
        // sha256 of normalizeContent(forkedContent) -- pinned so the test proves
        // the MATCHING mechanism, not just that some hash exists.
        sha256: 'f3b1f5f0b1a9dc0a5cf6f4c5d55f1ec33b7d1d0aa5b6b8c4a48b1b6c9e6d7b2e',
        knownPaths: ['scripts/narduk-toolchain.mjs'],
      },
    ]
    // Compute the real hash so the fixture and the seeded entry agree exactly
    // (avoids hand-computing sha256 and getting it wrong).
    seededForkList[0].sha256 = normalizedContentHash(forkedContent)

    // direction 1: no file present yet -> pass
    expect(statusOf('4.2', evaluateItem4(new AppRepo(root), seededForkList))).toBe('pass')

    // direction 2: seed the exact forked content -> fail, naming the file and owner
    writeFile(root, 'scripts/narduk-toolchain.mjs', forkedContent)
    const failing = evaluateItem4(new AppRepo(root), seededForkList)
    expect(statusOf('4.2', failing)).toBe('fail')
    const sub = failing.find((c) => c.id === '4.2')
    expect(sub?.detail).toContain('test-seeded-fork')

    // direction 3: editing the content even slightly clears the match again
    writeFile(root, 'scripts/narduk-toolchain.mjs', forkedContent + '\n// customised\n')
    expect(statusOf('4.2', evaluateItem4(new AppRepo(root), seededForkList))).toBe('pass')
  })

  it('4.2 real #76 fork fingerprints never match this package’s own conformant fixture', () => {
    const root = makeTempRepo()
    tempDirs.push(root)
    writeConformantBaseline(root)
    expect(statusOf('4.2', evaluateItem4(new AppRepo(root)))).toBe('pass')
  })

  it('4.3 fails a narduk-cli dependency, passes without one', () => {
    const root = makeTempRepo()
    tempDirs.push(root)
    writeConformantBaseline(root)
    writeJson(root, 'package.json', {
      name: 'x',
      scripts: { 'manifests:validate': 'true' },
      dependencies: { '@narduk-enterprises/narduk-cli': '1.0.0' },
    })
    expect(statusOf('4.3', evaluateItem4(new AppRepo(root)))).toBe('fail')

    writeConformantBaseline(root)
    expect(statusOf('4.3', evaluateItem4(new AppRepo(root)))).toBe('pass')
  })
})
