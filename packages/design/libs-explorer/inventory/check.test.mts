import assert from 'node:assert/strict'
import { dirname, join, resolve } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

import { CATALOG } from './catalog.mts'
import { checkCoverage, type CoverageFacts } from './check.mts'
import { EXAMPLES } from './examples.mts'
import { loadInventory } from './index.mts'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'

import { classifyTokens, parseTokens } from './tokens.mts'
import { readmeSections, readWorkspacePackages } from './workspace.mts'

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
    usageFiles: EXAMPLES.map(({ id }) => `${id}.usage`),
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

test('a setup specifier that is not an export fails; one that is passes', () => {
  const shell = CATALOG['@narduk-enterprises/narduk-shell']!
  const ui = CATALOG['@narduk-enterprises/narduk-ui']!
  const problems = checkCoverage(
    facts({
      catalog: {
        ...CATALOG,
        '@narduk-enterprises/narduk-shell': {
          ...shell,
          setup: { nuxtModule: '@narduk-enterprises/narduk-shell/nuxt' },
        },
        '@narduk-enterprises/narduk-ui': { ...ui, setup: { stylesheet: '@other/pkg/tokens.css' } },
      },
    }),
  )
  assert.equal(problems.length, 2)
  assert.match(problems[0] ?? '', /narduk-shell setup.nuxtModule ".*\/nuxt" is not/)
  assert.match(problems[1] ?? '', /narduk-ui setup.stylesheet "@other\/pkg\/tokens.css" is not/)
  // The real entries point at real exports (the clean-facts test above), and
  // a subpath export is accepted as well as the root.
  assert.equal(
    CATALOG['@narduk-enterprises/narduk-devices']?.setup?.nuxtModule,
    '@narduk-enterprises/narduk-devices/nuxt',
  )
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

test('an interactive file whose entry is not marked interactive fails', () => {
  // The exact regression: the flag removed, the file left behind, the demo silently gone.
  const examples = EXAMPLES.map((example) =>
    example.id === 'ne-data-table' ? { ...example, interactive: false } : example,
  )
  const problems = checkCoverage(facts({ examples, interactiveFiles: ['ne-data-table'] }))
  assert.equal(problems.length, 1)
  assert.match(problems[0] ?? '', /ne-data-table\.vue exists but .* is not marked interactive/)
})

test('an example without a usage source fails, and so does an orphan usage file', () => {
  const all = EXAMPLES.map(({ id }) => `${id}.usage`)
  const missing = checkCoverage(facts({ usageFiles: all.slice(1) }))
  assert.match(missing.join('\n'), /no usage source: add app\/usage\/ne-page-header\.usage\.vue/)
  const orphan = checkCoverage(facts({ usageFiles: [...all, 'ghost.usage'] }))
  assert.deepEqual(orphan, ['app/usage/ghost.usage.vue has no entry in inventory/examples.mts.'])
  // Named after the component, the file would typecheck against itself.
  const selfNamed = checkCoverage(facts({ usageFiles: [...all.slice(1), 'ne-page-header'] }))
  assert.match(selfNamed.join('\n'), /ne-page-header\.vue is not named <id>\.usage\.vue/)
})

function fixtureWorkspace(yaml: string, packages: Record<string, object | null>) {
  const root = mkdtempSync(join(tmpdir(), 'explorer-workspace-'))
  writeFileSync(join(root, 'pnpm-workspace.yaml'), yaml)
  for (const [directory, manifest] of Object.entries(packages)) {
    mkdirSync(join(root, directory), { recursive: true })
    if (manifest) writeFileSync(join(root, directory, 'package.json'), JSON.stringify(manifest))
  }
  return root
}

test('workspace discovery is the repository contract: supported patterns read, others refused', () => {
  const root = fixtureWorkspace('packages:\n  - "packages/a/*"\n  - packages/b/*\n', {
    'packages/a/one': { name: '@x/one', bin: { one: 'cli.js' } },
    'packages/b/two': { name: '@x/two', private: true, devDependencies: { '@x/one': '*' } },
  })
  try {
    const found = readWorkspacePackages(root)
    assert.deepEqual(
      found.map(({ name, slug, family, bin, workspaceDependencies }) => ({
        name,
        slug,
        family,
        bin,
        workspaceDependencies,
      })),
      [
        { name: '@x/one', slug: 'one', family: 'a', bin: ['one'], workspaceDependencies: [] },
        { name: '@x/two', slug: 'two', family: 'b', bin: [], workspaceDependencies: ['@x/one'] },
      ],
    )
  } finally {
    rmSync(root, { recursive: true, force: true })
  }

  for (const [yaml, error] of [
    ['packages:\n  - "packages/a/*"\n  - "!packages/a/*"\n', /negated workspace pattern/],
    ['packages:\n  - "packages/**"\n', /Unsupported workspace glob/],
    ['packages:\n  - "packages/missing/*"\n', /ENOENT/],
    ['catalog:\n  x: 1\n', /no packages entries/],
  ] as const) {
    const bad = fixtureWorkspace(yaml, { 'packages/a/one': { name: '@x/one' } })
    try {
      assert.throws(() => readWorkspacePackages(bad), error, yaml)
    } finally {
      rmSync(bad, { recursive: true, force: true })
    }
  }

  const noManifest = fixtureWorkspace('packages:\n  - packages/a/*\n', { 'packages/a/empty': null })
  try {
    assert.throws(() => readWorkspacePackages(noManifest), /ENOENT/)
  } finally {
    rmSync(noManifest, { recursive: true, force: true })
  }
})

test('README sections skip headings inside fenced code', () => {
  const markdown = [
    '# Title',
    '## Install',
    '```md',
    '## Not a section',
    '```',
    '~~~~',
    '## Also not',
    '```',
    '## Still not (a shorter fence of another kind does not close ~~~~)',
    '~~~~',
    '## Usage ##',
    '### Deeper',
  ].join('\n')
  assert.deepEqual(readmeSections(markdown), ['Install', 'Usage'])
})

test('tokens: strings, escapes and comments survive; conditions never erase a declaration', () => {
  assert.deepEqual(
    parseTokens(':root { --label: "}"; --color: red; }', 't.css').map(({ name, light }) => [
      name,
      light,
    ]),
    [
      ['--label', '"}"'],
      ['--color', 'red'],
    ],
  )
  assert.deepEqual(
    parseTokens(':root { --label: "a;b"; --color: red; }', 't.css').map(({ light }) => light),
    ['"a;b"', 'red'],
  )
  assert.deepEqual(
    parseTokens(':root { --escaped: "\\7d"; /* a } comment */ --after: 1px; }', 't.css').map(
      ({ light }) => light,
    ),
    ['"\\7d"', '1px'],
  )
  // The unconditional declaration stays; the nested conditional override is skipped.
  const nested = parseTokens(
    ':root {\n  --color: red;\n  @media (min-width: 1px) { --color: blue; }\n}',
    't.css',
  )
  assert.deepEqual(
    nested.map(({ name, light }) => [name, light]),
    [['--color', 'red']],
  )
})

test('tokens: light from :root/.light, dark from .dark, both from a shared rule; scopes skipped', () => {
  const css = `
    @import 'x.css';
    :root, .light { --a: #fff; --radius-x: 4px; }
    .dark { --a: #000; }
    :root, .dark { --both: 2px; }
    @media (width < 600px) { :root { --a: red; } }
    [data-app='x'] { --a: blue; }
  `
  assert.deepEqual(
    parseTokens(css, 'test.css').map(({ name, light, dark }) => ({ name, light, dark })),
    [
      { name: '--a', light: '#fff', dark: '#000' },
      { name: '--radius-x', light: '4px', dark: null },
      { name: '--both', light: '2px', dark: '2px' },
    ],
  )
})

test('tokens: every existing NE and NS family classifies by meaning, not by a var() reference', () => {
  const { inventory } = loadInventory(repoRoot, explorerRoot)
  const kind = (name: string) => {
    const token = inventory.tokens.find((candidate) => candidate.name === name)
    assert.ok(token, `${name} is not in the inventory`)
    return `${token.group}/${token.preview}`
  }
  const expected: Record<string, string> = {
    '--ne-accent': 'Color/color',
    '--ns-live': 'Color/color',
    '--ns-accent': 'Color/color', // var(--ns-ink-3), resolved
    '--ns-void-ring': 'Color/color', // rgb(var(--ns-ink-rgb) / 0.1)
    '--ns-hatch': 'Color/color',
    '--ns-bezel-fill': 'Color/color',
    '--ns-ink-rgb': 'Color/channels',
    '--ns-line': 'Color/color',
    '--ne-shadow-1': 'Elevation/shadow',
    '--ns-e0': 'Elevation/shadow',
    '--ns-e1': 'Elevation/shadow',
    '--ns-e3': 'Elevation/shadow',
    '--ns-well': 'Elevation/shadow',
    '--ns-bezel': 'Elevation/shadow',
    '--ne-radius-base': 'Radius/radius',
    '--ne-radius-control': 'Radius/radius',
    '--ns-r-sm': 'Radius/radius',
    '--ns-r-pill': 'Radius/radius',
    '--ne-font-sans': 'Typography/font-family',
    '--ns-font-mono': 'Typography/font-family',
    '--ne-text-body': 'Typography/font-size',
    '--ns-title-l-size': 'Typography/font-size',
    '--ne-leading-body': 'Typography/line-height',
    '--ns-body-line': 'Typography/line-height',
    '--ne-tracking-label': 'Typography/tracking',
    '--ns-readout-track': 'Typography/tracking',
    '--ns-space-4': 'Spacing/length',
    '--ns-gutter': 'Spacing/length',
    '--ns-margin-sm': 'Spacing/length',
    '--ns-tap-min': 'Spacing/length',
    '--ne-container': 'Layout/none',
    '--ne-header-height': 'Layout/none',
    '--ui-bg': 'Nuxt UI bridge/none',
  }
  assert.deepEqual(
    Object.fromEntries(Object.keys(expected).map((name) => [name, kind(name)])),
    expected,
  )
  // A reference is followed, not trusted: a var() to a radius is a radius.
  const [aliased] = classifyTokens([
    ...parseTokens(':root { --x-r-alias: var(--ns-r-sm); --ns-r-sm: 6px; }', 't.css'),
  ])
  assert.equal(`${aliased?.group}/${aliased?.preview}`, 'Radius/radius')
})
