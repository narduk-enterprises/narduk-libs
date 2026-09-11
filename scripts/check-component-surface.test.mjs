/**
 * Fixture tests for the component surface check (narduk-libs#250).
 *
 * `NE_SHELL_COMPONENTS` is empty on the branch that introduces the check, so
 * running it against the real package proves only that it does not crash: every
 * rule passes vacuously. These tests therefore build a throwaway package in a
 * temporary directory with a real registry entry and a real `format` export,
 * and remove one piece of evidence at a time. A rule that cannot fail is not a
 * gate, and this file is what makes each of the four a gate before the first
 * component lane depends on it.
 */

import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import test, { after } from 'node:test'

import {
  CHECKED_PACKAGE_DIRS,
  PENDING_CARDS,
  ROOT,
  checkComponentSurface,
  kebabCase,
  pendingCardsFor,
  rulesFor,
} from './check-component-surface.mjs'

const script = join(ROOT, 'scripts/check-component-surface.mjs')
const temporaryDirectories = []

after(() => {
  for (const directory of temporaryDirectories) rmSync(directory, { recursive: true, force: true })
})

/** The complete, passing surface of a one-component, one-formatter package. */
function completeFixture() {
  return {
    'src/registry.ts': `export interface NeComponentRegistration { name: string; filePath: string }
export const NE_SHELL_COMPONENTS: readonly NeComponentRegistration[] = [
  { name: 'NeStatePanel', filePath: './runtime/components/NeStatePanel.vue' },
]
`,
    'src/format.ts': `export function formatCount(value: number): string { return String(value) }\n`,
    'README.md': '# fixture\n\n### NeStatePanel\n\nProps, slots, events.\n\n### formatCount\n',
    'src/runtime/components/NeStatePanel.test.ts': `import { mount } from '@vue/test-utils'
import NeStatePanel from './NeStatePanel.vue'
it('renders', () => { expect(mount(NeStatePanel).text()).toBe('') })
`,
    'src/runtime/components/NeStatePanel.ssr.test.ts': `import { renderToString } from '@vue/server-renderer'
import NeStatePanel from './NeStatePanel.vue'
it('server renders', async () => { expect(await renderToString(NeStatePanel)).toContain('<div') })
`,
    'src/design-cards/NeStatePanel.card.vue': `<template>
  <section class="preview-card" data-design-card="ne-state-panel" data-name="State panel" data-group="Shell">
    <NeStatePanel />
  </section>
</template>
`,
    'src/format.test.ts': `import { formatCount } from './format'
it('formats', () => { expect(formatCount(2)).toBe('2') })
`,
  }
}

/** Write a fixture package, optionally without the files named in `without`. */
function fixture(without = []) {
  const directory = mkdtempSync(join(tmpdir(), 'narduk-surface-fixture-'))
  temporaryDirectories.push(directory)
  for (const [path, contents] of Object.entries(completeFixture())) {
    if (without.includes(path)) continue
    mkdirSync(dirname(join(directory, path)), { recursive: true })
    writeFileSync(join(directory, path), contents)
  }
  return directory
}

const check = (directory) =>
  checkComponentSurface({ packageName: 'fixture', packageDirectory: directory })

test('a component with all four kinds of evidence passes, and the report lists them', async () => {
  const report = await check(fixture())
  assert.deepEqual(report.misses, [])
  assert.deepEqual(report.waived, [])
  assert.deepEqual(report.entries, [
    {
      name: 'NeStatePanel',
      kind: 'component',
      required: ['readme', 'mount', 'ssr', 'card'],
      satisfied: ['readme', 'mount', 'ssr', 'card'],
    },
    {
      name: 'formatCount',
      kind: 'format',
      required: ['readme', 'unit'],
      satisfied: ['readme', 'unit'],
    },
  ])
})

test('each of the four component requirements fails on its own when the evidence is gone', async () => {
  const cases = [
    ['README.md', 'readme', /heading naming NeStatePanel/],
    ['src/runtime/components/NeStatePanel.test.ts', 'mount', /mount\(NeStatePanel/],
    ['src/runtime/components/NeStatePanel.ssr.test.ts', 'ssr', /renderToString/],
    ['src/design-cards/NeStatePanel.card.vue', 'card', /data-design-card="ne-state-panel"/],
  ]
  for (const [path, rule, fix] of cases) {
    const report = await check(fixture([path]))
    const component = report.misses.filter((miss) => miss.name === 'NeStatePanel')
    assert.deepEqual(
      component.map((miss) => miss.rule),
      [rule],
      `removing ${path} must fail exactly the ${rule} rule`,
    )
    assert.match(component[0].message, fix)
    assert.match(component[0].message, /^NeStatePanel: missing /)
  }
})

test('both format requirements fail on their own, and no card or mount is demanded of a function', async () => {
  assert.deepEqual(rulesFor('format'), ['readme', 'unit'])
  const withoutReadme = await check(fixture(['README.md']))
  assert.deepEqual(
    withoutReadme.misses.filter((miss) => miss.name === 'formatCount').map((miss) => miss.rule),
    ['readme'],
  )
  const withoutTest = await check(fixture(['src/format.test.ts']))
  const misses = withoutTest.misses.filter((miss) => miss.name === 'formatCount')
  assert.deepEqual(
    misses.map((miss) => miss.rule),
    ['unit'],
  )
  assert.match(misses[0].message, /importing formatCount from the `format` module/)
})

test('a README mention that is not a heading, and a card with the wrong id, do not count', async () => {
  const mentioned = fixture(['README.md'])
  writeFileSync(
    join(mentioned, 'README.md'),
    '# fixture\n\nNeStatePanel is great, see formatCount too.\n\n| NeStatePanel | x |\n',
  )
  const report = await check(mentioned)
  assert.deepEqual(
    report.misses.map((miss) => `${miss.name}/${miss.rule}`),
    ['NeStatePanel/readme', 'formatCount/readme'],
  )

  const misIdentified = fixture(['src/design-cards/NeStatePanel.card.vue'])
  mkdirSync(join(misIdentified, 'src/design-cards'), { recursive: true })
  writeFileSync(
    join(misIdentified, 'src/design-cards/NeStatePanel.card.vue'),
    '<template><section data-design-card="state-panel"><NeStatePanel /></section></template>\n',
  )
  assert.deepEqual(
    (await check(misIdentified)).misses.map((miss) => miss.rule),
    ['card'],
  )
})

test('an SSR test alone does not satisfy the mount rule, and vice versa', async () => {
  // The two rules exist because a DOM mount and a DOM-free server render fail
  // differently. One file answering for both would collapse them back together.
  const mountOnly = fixture(['src/runtime/components/NeStatePanel.ssr.test.ts'])
  writeFileSync(
    join(mountOnly, 'src/runtime/components/NeStatePanel.test.ts'),
    "import { mount } from '@vue/test-utils'\nmount(NeStatePanel)\nrenderToString(NeStatePanel)\n",
  )
  assert.deepEqual(
    (await check(mountOnly)).misses.map((miss) => miss.rule),
    ['ssr'],
  )

  const ssrOnly = fixture(['src/runtime/components/NeStatePanel.test.ts'])
  assert.deepEqual(
    (await check(ssrOnly)).misses.map((miss) => miss.rule),
    ['mount'],
  )
})

test('kebab card ids follow the component name, including acronyms', () => {
  assert.equal(kebabCase('NeStatePanel'), 'ne-state-panel')
  assert.equal(kebabCase('NeKpiTile'), 'ne-kpi-tile')
  assert.equal(kebabCase('NeURLField'), 'ne-url-field')
})

test('an unreadable registry fails closed instead of reporting an empty surface', async () => {
  const broken = fixture(['src/registry.ts'])
  writeFileSync(join(broken, 'src/registry.ts'), 'export enum Broken { A }\n')
  await assert.rejects(check(broken), /Cannot read the component registry/)

  const wrongShape = fixture(['src/registry.ts'])
  writeFileSync(join(wrongShape, 'src/registry.ts'), 'export const NE_SHELL_COMPONENTS = {}\n')
  await assert.rejects(check(wrongShape), /must export NE_SHELL_COMPONENTS as an array/)
})

test('the command line exits 1 with per-miss lines, and 0 when the surface is complete', () => {
  const run = (arguments_) =>
    execFileSync(process.execPath, [script, ...arguments_], { encoding: 'utf8' })

  assert.match(run(['--package-dir', fixture()]), /1 component\(s\) and 1 format export\(s\)/)

  const incomplete = fixture(['src/design-cards/NeStatePanel.card.vue', 'src/format.test.ts'])
  try {
    run(['--package-dir', incomplete])
    assert.fail('an incomplete surface must exit non-zero')
  } catch (error) {
    assert.equal(error.status, 1)
    assert.match(error.stdout, /NeStatePanel: missing design card/)
    assert.match(error.stdout, /formatCount: missing unit test/)
    assert.match(error.stdout, /2 surface requirement\(s\) missing across 2 registered name\(s\)/)
  }
})

test('--json reports the same verdict in a machine-readable shape for CI', () => {
  const complete = JSON.parse(
    execFileSync(process.execPath, [script, '--package-dir', fixture(), '--json'], {
      encoding: 'utf8',
    }),
  )
  assert.equal(complete.ok, true)
  assert.deepEqual(complete.misses, [])

  try {
    execFileSync(process.execPath, [script, '--package-dir', fixture(['README.md']), '--json'], {
      encoding: 'utf8',
    })
    assert.fail('an incomplete surface must exit non-zero with --json too')
  } catch (error) {
    assert.equal(error.status, 1)
    const report = JSON.parse(error.stdout)
    assert.equal(report.ok, false)
    assert.deepEqual(
      report.misses.map((miss) => miss.rule),
      ['readme', 'readme'],
    )
  }
})

test('the real narduk-shell package is the default scope and passes today', () => {
  const output = execFileSync(process.execPath, [script], { encoding: 'utf8' })
  assert.match(output, /@narduk-enterprises\/narduk-shell: \d+ component\(s\)/)
})

test('a package that has not joined the check yet is an error, not a silent pass', () => {
  try {
    execFileSync(process.execPath, [script, '--package', '@narduk-enterprises/narduk-ui'], {
      encoding: 'utf8',
      stdio: 'pipe',
    })
    assert.fail('an unscoped package must not report success')
  } catch (error) {
    assert.equal(error.status, 1)
    assert.match(error.stderr, /is not in the component surface check yet/)
    assert.match(error.stderr, /backlog item 22/)
  }
})

test('scope is one directory per line, and only the real package gets pendingCards', () => {
  assert.deepEqual(CHECKED_PACKAGE_DIRS, ['packages/design/narduk-shell'])
  assert.deepEqual(pendingCardsFor(join(ROOT, 'packages/design/narduk-shell')), [...PENDING_CARDS])
  assert.deepEqual(pendingCardsFor(fixture()), [])
})

test('pendingCards waives only the card rule, and only for listed names', async () => {
  assert.deepEqual(
    [...PENDING_CARDS],
    ['NeStatePanel', 'NeStatusBadge', 'NePageHeader', 'NeSectionHeader', 'NeConfirmDialog'],
  )

  const waived = await checkComponentSurface({
    packageName: 'fixture',
    packageDirectory: fixture(['src/design-cards/NeStatePanel.card.vue']),
    pendingCards: ['NeStatePanel'],
  })
  assert.deepEqual(
    waived.misses.filter((miss) => miss.name === 'NeStatePanel'),
    [],
  )
  assert.deepEqual(waived.waived, ['NeStatePanel'])
  assert.deepEqual(
    waived.entries.find((entry) => entry.name === 'NeStatePanel')?.required,
    ['readme', 'mount', 'ssr'],
  )

  const notListed = await checkComponentSurface({
    packageName: 'fixture',
    packageDirectory: fixture(['src/design-cards/NeStatePanel.card.vue']),
    pendingCards: ['NeStatusBadge'],
  })
  assert.deepEqual(
    notListed.misses.filter((miss) => miss.name === 'NeStatePanel').map((miss) => miss.rule),
    ['card'],
  )

  const stillNeedsReadme = await checkComponentSurface({
    packageName: 'fixture',
    packageDirectory: fixture(['README.md', 'src/design-cards/NeStatePanel.card.vue']),
    pendingCards: ['NeStatePanel'],
  })
  assert.deepEqual(
    stillNeedsReadme.misses
      .filter((miss) => miss.name === 'NeStatePanel')
      .map((miss) => miss.rule),
    ['readme'],
  )
})

test('an unused pendingCards name is ignored, so the list can sit on main before those lanes rebase', async () => {
  const report = await check(fixture())
  const withFuture = await checkComponentSurface({
    packageName: 'fixture',
    packageDirectory: fixture(),
    pendingCards: ['NeConfirmDialog'],
  })
  assert.deepEqual(withFuture.misses, report.misses)
  assert.deepEqual(withFuture.waived, [])
})
