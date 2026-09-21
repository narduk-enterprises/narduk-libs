import assert from 'node:assert/strict'
import { dirname, resolve } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

import { CATALOG } from './catalog.mts'
import { checkCoverage, type CoverageFacts } from './check.mts'
import { EXAMPLES } from './examples.mts'
import { loadInventory } from './index.mts'
import { parseTokens, topLevelRules } from './tokens.mts'
import { readWorkspacePackages, readWorkspacePatterns } from './workspace.mts'

const explorerRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const repoRoot = resolve(explorerRoot, '../../..')

test('the real workspace passes the coverage check', () => {
  const { inventory, problems } = loadInventory(repoRoot, explorerRoot)
  assert.deepEqual(problems, [])
  assert.equal(inventory.packages.length, readWorkspacePackages(repoRoot).length)
  assert.ok(inventory.tokens.some(({ name }) => name === '--ne-accent'))
  assert.ok(inventory.tokens.some(({ name }) => name === '--ns-ink'))
})

test('every workspace package from pnpm-workspace.yaml is in the catalog', () => {
  const names = readWorkspacePackages(repoRoot).map(({ name }) => name)
  assert.ok(names.length >= 28, `expected the whole workspace, got ${names.length}`)
  assert.deepEqual(Object.keys(CATALOG).sort(), [...names].sort())
})

function facts(overrides: Partial<CoverageFacts> = {}): CoverageFacts {
  const packages = readWorkspacePackages(repoRoot)
  return {
    packages,
    catalog: CATALOG,
    examples: EXAMPLES,
    shellComponents: EXAMPLES.flatMap(({ component }) => (component ? [component] : [])),
    cards: EXAMPLES.flatMap(({ card }) => (card ? [card] : [])),
    interactiveFiles: EXAMPLES.filter(({ interactive }) => interactive).map(({ id }) => id),
    ...overrides,
  }
}

test('the fixture facts are clean, so each case below fails for its own reason', () => {
  assert.deepEqual(checkCoverage(facts()), [])
})

test('a workspace package without a catalog entry fails', () => {
  const { ['@narduk-enterprises/narduk-seo']: _removed, ...catalog } = CATALOG
  const problems = checkCoverage(facts({ catalog }))
  assert.equal(problems.length, 1)
  assert.match(problems[0] ?? '', /narduk-seo .* has no catalog entry/)
})

test('a catalog entry for a package that is gone fails', () => {
  const catalog = {
    ...CATALOG,
    '@narduk-enterprises/removed': { kind: 'tooling' as const, capabilities: ['x'] },
  }
  assert.match(
    checkCoverage(facts({ catalog })).join('\n'),
    /removed, which is not in the workspace/,
  )
})

test('duplicate example ids fail', () => {
  const examples = [...EXAMPLES, { ...EXAMPLES[0]! }]
  assert.match(checkCoverage(facts({ examples })).join('\n'), /registered twice/)
})

test('a broken demo reference fails', () => {
  const catalog = {
    ...CATALOG,
    '@narduk-enterprises/narduk-ui': {
      kind: 'visual' as const,
      capabilities: ['x'],
      demos: ['nope'],
    },
  }
  assert.match(checkCoverage(facts({ catalog })).join('\n'), /links the demo "nope"/)
})

test('a registered shell component with no example fails', () => {
  const shellComponents = [...facts().shellComponents, 'NeNewThing']
  assert.match(checkCoverage(facts({ shellComponents })).join('\n'), /registers NeNewThing/)
})

test('a missing design card or interactive file fails, and so does an orphan file', () => {
  assert.match(
    checkCoverage(facts({ cards: [] })).join('\n'),
    /design card NePageHeader\.card\.vue/,
  )
  assert.match(
    checkCoverage(facts({ interactiveFiles: [] })).join('\n'),
    /ne-data-table\.vue is missing/,
  )
  const orphan = checkCoverage(facts({ interactiveFiles: ['ne-data-table', 'ghost'] }))
  assert.match(orphan.join('\n'), /ghost\.vue has no entry/)
})

test('workspace patterns: reads this repository, refuses what it cannot read', () => {
  assert.deepEqual(readWorkspacePatterns('packages:\n  - "packages/a/*"\n  - packages/b/*\n'), [
    'packages/a/*',
    'packages/b/*',
  ])
  assert.throws(() => readWorkspacePatterns('packages:\n  - "packages/**"\n'), /only "<dir>\/\*"/)
  assert.throws(() => readWorkspacePatterns('catalog:\n  x: 1\n'), /lists no packages/)
})

test('tokens: light from :root/.light, dark from .dark, overrides in @media and scopes skipped', () => {
  const css = `
    @import 'x.css';
    /* a comment with { braces } */
    :root, .light { --a: #fff; --radius-x: 4px; }
    .dark { --a: #000; }
    @media (width < 600px) { :root { --a: red; } }
    [data-app='x'] { --a: blue; }
  `
  assert.equal(topLevelRules(css).length, 3)
  assert.deepEqual(parseTokens(css, 'test.css'), [
    { name: '--a', source: 'test.css', group: 'Color', light: '#fff', dark: '#000' },
    { name: '--radius-x', source: 'test.css', group: 'Radius', light: '4px', dark: null },
  ])
})
