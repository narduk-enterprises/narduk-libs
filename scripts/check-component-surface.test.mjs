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
import { dirname, join, relative } from 'node:path'
import test, { after } from 'node:test'

import {
  CHECKED_PACKAGE_DIRS,
  PACKAGE_SURFACE_CONFIG,
  PENDING_CARDS,
  ROOT,
  checkComponentSurface,
  kebabCase,
  parseComponentBarrel,
  pendingCardsFor,
  readSurface,
  rulesFor,
  surfaceConfigFor,
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
    'src/design-cards/NeStatePanel.card.vue': `<script setup lang="ts">
import NeStatePanel from '../runtime/components/NeStatePanel.vue'
</script>
<template>
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
    "import { mount } from '@vue/test-utils'\nimport NeStatePanel from './NeStatePanel.vue'\nmount(NeStatePanel)\nrenderToString(NeStatePanel)\n",
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

test('a named import from a barrel-like specifier satisfies mount/ssr/card too, not just a per-file import path', async () => {
  // narduk-charts's ssr.test.ts and narduk-ui's instruments.test.ts/ssr.test.ts
  // import every component by name from one barrel file (`./index`,
  // `../instruments`) rather than each having its own file-path import — see
  // `importsArtefact` in check-component-surface.mjs. This fixture reproduces
  // that shape for the shell surface shape, to isolate the behavior from
  // barrel *surface reading* (covered separately by parseComponentBarrel and
  // the real-package tests below).
  const directory = fixture([
    'src/runtime/components/NeStatePanel.test.ts',
    'src/runtime/components/NeStatePanel.ssr.test.ts',
    'src/design-cards/NeStatePanel.card.vue',
  ])
  // Both files under this directory are excluded above, so unlike the
  // single-file-removed fixtures elsewhere in this file, the directory itself
  // was never created.
  mkdirSync(join(directory, 'src/runtime/components'), { recursive: true })
  writeFileSync(
    join(directory, 'src/runtime/components/NeStatePanel.test.ts'),
    "import { mount } from '@vue/test-utils'\nimport { NeStatePanel } from './barrel'\nit('renders', () => { expect(mount(NeStatePanel).text()).toBe('') })\n",
  )
  writeFileSync(
    join(directory, 'src/runtime/components/NeStatePanel.ssr.test.ts'),
    "import { renderToString } from '@vue/server-renderer'\nimport { NeStatePanel } from './barrel'\nit('server renders', async () => { expect(await renderToString(NeStatePanel)).toContain('<div') })\n",
  )
  mkdirSync(join(directory, 'src/design-cards'), { recursive: true })
  writeFileSync(
    join(directory, 'src/design-cards/NeStatePanel.card.vue'),
    `<script setup lang="ts">
import { NeStatePanel } from '../runtime/components/barrel'
</script>
<template>
  <section class="preview-card" data-design-card="ne-state-panel"><NeStatePanel /></section>
</template>
`,
  )
  const report = await check(directory)
  assert.deepEqual(
    report.misses.filter((miss) => miss.name === 'NeStatePanel'),
    [],
  )
})

/*
 * The tightened-rule fixtures below reproduce, one rule at a time, the exact
 * gaming shapes a PR review found: a `mount(Name` reference that exists only
 * in a comment, an SSR test whose `renderToString` targets something
 * unrelated to the named component, an empty `data-design-card` section with
 * nothing rendered inside it, and a `format` "test" whose only assertion is
 * `expect(true).toBe(true)`. Before the fix (comment stripping, plus
 * requiring a real import of the artefact under test) every one of these
 * passed its rule; each must now fail it.
 */

test('tightened rules: a mount() reference that exists only in a comment does not satisfy the mount rule', async () => {
  const directory = fixture(['src/runtime/components/NeStatePanel.test.ts'])
  writeFileSync(
    join(directory, 'src/runtime/components/NeStatePanel.test.ts'),
    "// mount(NeStatePanel) -- pretend this file mounts it via @vue/test-utils\nit('does nothing', () => { expect(true).toBe(true) })\n",
  )
  assert.deepEqual(
    (await check(directory)).misses
      .filter((miss) => miss.name === 'NeStatePanel')
      .map((miss) => miss.rule),
    ['mount'],
  )
})

test('tightened rules: renderToString on an unrelated component does not satisfy the ssr rule', async () => {
  const directory = fixture(['src/runtime/components/NeStatePanel.ssr.test.ts'])
  writeFileSync(
    join(directory, 'src/runtime/components/NeStatePanel.ssr.test.ts'),
    `import { renderToString } from '@vue/server-renderer'
import { createSSRApp, defineComponent, h } from 'vue'
// NeStatePanel already has coverage elsewhere -- this file renders something
// else entirely, but still names the component and calls renderToString.
const Unrelated = defineComponent({ setup: () => () => h('div', 'unrelated') })
it('server renders something', async () => {
  expect(await renderToString(createSSRApp(Unrelated))).toContain('unrelated')
})
`,
  )
  assert.deepEqual(
    (await check(directory)).misses
      .filter((miss) => miss.name === 'NeStatePanel')
      .map((miss) => miss.rule),
    ['ssr'],
  )
})

test('tightened rules: an empty design-card section with nothing rendered does not satisfy the card rule', async () => {
  const directory = fixture(['src/design-cards/NeStatePanel.card.vue'])
  mkdirSync(join(directory, 'src/design-cards'), { recursive: true })
  writeFileSync(
    join(directory, 'src/design-cards/NeStatePanel.card.vue'),
    '<template>\n  <section data-design-card="ne-state-panel" data-name="State panel" data-group="Shell"></section>\n</template>\n',
  )
  assert.deepEqual(
    (await check(directory)).misses
      .filter((miss) => miss.name === 'NeStatePanel')
      .map((miss) => miss.rule),
    ['card'],
  )
})

test('tightened rules: a format "test" with no real import and a fake assertion does not satisfy the unit rule', async () => {
  const directory = fixture(['src/format.test.ts'])
  writeFileSync(
    join(directory, 'src/format.test.ts'),
    "// formatCount already has format coverage elsewhere.\nit('formats', () => { expect(true).toBe(true) })\n",
  )
  assert.deepEqual(
    (await check(directory)).misses
      .filter((miss) => miss.name === 'formatCount')
      .map((miss) => miss.rule),
    ['unit'],
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

test('with no args, the check covers every directory in CHECKED_PACKAGE_DIRS, not just the first', () => {
  const output = execFileSync(process.execPath, [script], { encoding: 'utf8' })
  assert.match(output, /@narduk-enterprises\/narduk-shell: \d+ component\(s\)/)
  assert.match(output, /@narduk-enterprises\/narduk-charts: 8 component\(s\)/)
  assert.match(output, /@narduk-enterprises\/narduk-ui: 4 component\(s\)/)
})

test('a package that has not joined the check yet is an error, not a silent pass', () => {
  try {
    execFileSync(process.execPath, [script, '--package', '@narduk-enterprises/narduk-mapkit-nuxt'], {
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

test('scope is one directory per line, and only the shell package gets pendingCards', () => {
  assert.deepEqual(CHECKED_PACKAGE_DIRS, [
    'packages/design/narduk-shell',
    'packages/design/narduk-charts',
    'packages/design/narduk-ui',
  ])
  assert.deepEqual(pendingCardsFor(join(ROOT, 'packages/design/narduk-shell')), [...PENDING_CARDS])
  assert.deepEqual(pendingCardsFor(join(ROOT, 'packages/design/narduk-charts')), [])
  assert.deepEqual(pendingCardsFor(join(ROOT, 'packages/design/narduk-ui')), [])
  assert.deepEqual(pendingCardsFor(fixture()), [])
})

test('the real narduk-charts and narduk-ui packages read their barrel surface and pass today', async () => {
  const chartsOutput = execFileSync(
    process.execPath,
    [script, '--package', '@narduk-enterprises/narduk-charts'],
    { encoding: 'utf8' },
  )
  assert.match(chartsOutput, /@narduk-enterprises\/narduk-charts: 8 component\(s\) and 0 format/)

  const uiOutput = execFileSync(process.execPath, [script, '--package', 'narduk-ui'], {
    encoding: 'utf8',
  })
  assert.match(uiOutput, /narduk-ui: 4 component\(s\) and 0 format/)

  const chartsSurface = await readSurface(join(ROOT, 'packages/design/narduk-charts'))
  assert.deepEqual(
    chartsSurface.map((entry) => entry.name).sort(),
    [
      'NardukBarChart',
      'NardukBrandBackdrop',
      'NardukCandleChart',
      'NardukChartStack',
      'NardukHistogramChart',
      'NardukLineChart',
      'NardukPieChart',
      'NardukScatterChart',
    ],
  )
  assert.ok(chartsSurface.every((entry) => entry.kind === 'component'))
})

test('surfaceConfigFor reads the barrel config for a listed package, and null for everything else', () => {
  assert.deepEqual(surfaceConfigFor(join(ROOT, 'packages/design/narduk-charts')), {
    componentsBarrel: 'src/index.ts',
    designCardsDir: 'src/design-cards',
  })
  assert.deepEqual(surfaceConfigFor(join(ROOT, 'packages/design/narduk-ui')), {
    componentsBarrel: 'instruments/index.ts',
    designCardsDir: 'design-cards',
  })
  assert.equal(surfaceConfigFor(join(ROOT, 'packages/design/narduk-shell')), null)
  assert.equal(surfaceConfigFor(fixture()), null)
  assert.deepEqual(Object.keys(PACKAGE_SURFACE_CONFIG).sort(), [
    'packages/design/narduk-charts',
    'packages/design/narduk-ui',
  ])
})

test('parseComponentBarrel reads only `export { default as Name } from \'./Name.vue\'` lines', () => {
  const source = `
    /** A component. */
    export { default as NsThing } from './NsThing.vue'
    // export { default as Commented } from './Commented.vue'
    export { default as NsOther } from "./NsOther.vue"
    export { useSomething } from './useSomething'
    export { NotDefault } from './NotDefault.vue'
    export * from './everything'
    export type { SomeType } from './types'
  `
  assert.deepEqual(parseComponentBarrel(source), ['NsThing', 'NsOther'])
})

test('a barrel with no component re-exports fails closed instead of reporting an empty surface', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'narduk-surface-barrel-fixture-'))
  temporaryDirectories.push(directory)
  mkdirSync(join(directory, 'src'), { recursive: true })
  writeFileSync(join(directory, 'src/index.ts'), 'export const notAComponent = 1\n')

  // PACKAGE_SURFACE_CONFIG is keyed by a path relative to ROOT. Point one
  // entry at this fixture just long enough to prove readSurface's barrel
  // branch fails closed the same way the shell branch's `load()` does above,
  // then remove it so no other test sees an extra config entry.
  const relativeDirectory = relative(ROOT, directory)
  PACKAGE_SURFACE_CONFIG[relativeDirectory] = {
    componentsBarrel: 'src/index.ts',
    designCardsDir: 'src/design-cards',
  }
  try {
    await assert.rejects(readSurface(directory), /exports no .*export \{ default as Name \}/)
  } finally {
    delete PACKAGE_SURFACE_CONFIG[relativeDirectory]
  }
})

test('pendingCards waives only the card rule, and only for listed names', async () => {
  // The waiver is spent: all five names it covered now ship a real card
  // (narduk-libs#250's follow-up), and the list stays empty going forward.
  assert.deepEqual([...PENDING_CARDS], [])

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
  assert.deepEqual(waived.entries.find((entry) => entry.name === 'NeStatePanel')?.required, [
    'readme',
    'mount',
    'ssr',
  ])

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
    stillNeedsReadme.misses.filter((miss) => miss.name === 'NeStatePanel').map((miss) => miss.rule),
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
