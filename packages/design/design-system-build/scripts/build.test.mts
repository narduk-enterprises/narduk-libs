import assert from 'node:assert/strict'
import test from 'node:test'
import {
  galleryCoverage,
  kebabCase,
  mergeCoverage,
  renderBundle,
  shellCardPlan,
  splitStyles,
} from './build.mts'
import postcss from 'postcss'

const card =
  '<section data-design-card="freshness" data-name="Freshness" data-group="Instruments"><span class="ns-chip">LIVE</span></section>'

test('static export keeps SSR component markup, scoped CSS and explicit stylesheet paths', () => {
  const first = renderBundle(
    `<html><body>${card}<script>hydrate()</script></body></html>`,
    '.ns-chip[data-v-123]{color:green}',
  )
  assert.deepEqual(
    first,
    renderBundle(
      `<html><body>${card}<script>differentBuildId()</script></body></html>`,
      '.ns-chip[data-v-123]{color:green}',
    ),
  )
  assert.match(first.files['cards/freshness.html']!, /^<!-- @dsCard/)
  assert.match(first.files['cards/freshness.html']!, /@dsCard group="Instruments" name="Freshness"/)
  assert.match(first.files['cards/freshness.html']!, /class="ns-chip"/)
  assert.doesNotMatch(first.files['index.html']!, /<script/)
  assert.doesNotMatch(first.files['index.html']!, /data-app=/)
  assert.deepEqual(JSON.parse(first.files['_ds_manifest.json']!).globalCssPaths, [
    'tokens.css',
    'styles.css',
  ])
  assert.match(first.files['cards/freshness.html']!, /href="\.\.\/styles.css"/)
})

test('token extraction preserves selectors, media and layer order without utility rules', () => {
  const css =
    '@layer base, components;@layer base{:root{--ns-ink:#123;color:var(--ns-ink)}}@media(width<620px){:root{--ns-margin:16px}}[data-app="riverstatus"]{--ns-accent:teal}.flex{display:flex}'
  const { tokens, styles } = splitStyles(css)
  assert.match(tokens, /@layer base, components/)
  assert.match(tokens, /@media\(width<620px\)/)
  assert.match(tokens, /\[data-app="riverstatus"\]/)
  assert.doesNotMatch(tokens, /display:flex|color:var/)
  assert.match(styles, /color:var\(--ns-ink\)/)
  const declarations: string[] = []
  postcss.parse(tokens).walkDecls((decl) => {
    declarations.push(decl.prop)
  })
  assert.deepEqual(declarations, ['--ns-ink', '--ns-margin', '--ns-accent'])
  postcss.parse(styles).walkDecls((decl) => {
    assert.ok(!decl.prop.startsWith('--ns-'))
  })
})

test('coverage follows gallery component additions and removals without a second list', () => {
  const source =
    '<template><main><section data-design-card="readouts"><NsReadoutTile/><NsReadoutTile/><UButton/></section><section data-design-card="new"><UBadge/><NsRangeBar/></section></main></template>'
  assert.deepEqual(galleryCoverage(source), {
    readouts: ['NsReadoutTile', 'UButton'],
    new: ['NsRangeBar', 'UBadge'],
  })
  assert.deepEqual(galleryCoverage(source.replace('<NsRangeBar/>', '')).new, ['UBadge'])
  assert.throws(
    () =>
      galleryCoverage(
        '<template><section data-design-card="x"><section data-design-card="y"/></section></template>',
      ),
    /nested/,
  )
})

test('incomplete or executable previews fail before publishing output', () => {
  assert.throws(() => renderBundle('<div>missing</div>', 'body{}'), /No prerendered/)
  assert.throws(() => renderBundle(card + card, 'body{}'), /Duplicate/)
  assert.throws(
    () => renderBundle(card.replace('</section>', '<script>run()</script></section>'), 'body{}'),
    /executable/,
  )
  assert.throws(
    () => renderBundle(card, '@import "https://example.com/style.css";'),
    /self-contained/,
  )
  assert.throws(() => renderBundle(card, 'body{background:url(/missing.png)}'), /self-contained/)
})

/*
 * narduk-shell cards (components backlog item 3, narduk-libs#250).
 *
 * The registry is empty on the branch that introduces this mechanism, so the
 * real build exercises none of these paths. Fixtures stand in for the registry
 * and the card directory so that each rule fails for a reason before the first
 * component lane relies on it.
 */

const shellCard = (id: string, body = '<NeStatePanel />') =>
  `<template><section class="preview-card" data-design-card="${id}" data-name="State panel" data-group="Shell">${body}</section></template>`

test('a registered component with no card fails the build, naming the template to copy', () => {
  assert.throws(
    () =>
      shellCardPlan([{ name: 'NeStatePanel' }, { name: 'NeKpiTile' }], ['NeKpiTile.card.vue'], []),
    (error: Error) => {
      assert.match(error.message, /Registered components with no design card: NeStatePanel/)
      assert.match(error.message, /template\/NeExample\.card\.vue/)
      return true
    },
  )
})

test('a card with no registered component fails too, so NE Base cannot advertise an unusable component', () => {
  assert.throws(
    () => shellCardPlan([{ name: 'NeKpiTile' }], ['NeKpiTile.card.vue', 'NeGhost.card.vue']),
    /Design cards with no registered component: NeGhost\.card\.vue/,
  )
})

test('the plan pairs each component with its file and kebab card id, in registry order', () => {
  assert.deepEqual(
    shellCardPlan(
      [{ name: 'NeStatePanel' }, { name: 'NeKpiTile' }],
      ['NeKpiTile.card.vue', 'NeStatePanel.card.vue'],
    ),
    [
      { name: 'NeStatePanel', file: 'NeStatePanel.card.vue', id: 'ne-state-panel' },
      { name: 'NeKpiTile', file: 'NeKpiTile.card.vue', id: 'ne-kpi-tile' },
    ],
  )
  assert.deepEqual(shellCardPlan([], []), [])
  assert.equal(kebabCase('NeURLField'), 'ne-url-field')
})

test('pendingCards lets a listed component land without a card; a name not on the list still fails', () => {
  assert.deepEqual(
    shellCardPlan(
      [{ name: 'NeStatePanel' }, { name: 'NeKpiTile' }],
      ['NeKpiTile.card.vue'],
      ['NeStatePanel'],
    ),
    [{ name: 'NeKpiTile', file: 'NeKpiTile.card.vue', id: 'ne-kpi-tile' }],
  )
  assert.throws(
    () =>
      shellCardPlan(
        [{ name: 'NeStatePanel' }, { name: 'NeKpiTile' }],
        ['NeKpiTile.card.vue'],
        ['NeStatusBadge'],
      ),
    /Registered components with no design card: NeStatePanel/,
  )
})

test('coverage merges the authored gallery with each shipped card, and counts Ne* tags', () => {
  const merged = mergeCoverage({
    'app.vue':
      '<template><main><section data-design-card="freshness"><NsFreshnessChip/></section></main></template>',
    'NeStatePanel.card.vue': shellCard('ne-state-panel', '<NeStatePanel/><UButton/><div/>'),
  })
  assert.deepEqual(merged, {
    freshness: ['NsFreshnessChip'],
    'ne-state-panel': ['NeStatePanel', 'UButton'],
  })
})

test('two sources claiming one card id is an error, not a silently dropped card', () => {
  assert.throws(
    () =>
      mergeCoverage({
        'app.vue': '<template><section data-design-card="ne-state-panel"/></template>',
        'NeStatePanel.card.vue': shellCard('ne-state-panel'),
      }),
    /Duplicate design card id "ne-state-panel" in app\.vue and NeStatePanel\.card\.vue/,
  )
})

test('a shipped card renders into the bundle exactly like an authored one', () => {
  const rendered = renderBundle(
    '<html><body><section data-design-card="ne-state-panel" data-name="State panel" data-group="Shell"><p class="ne-panel">Empty</p></section></body></html>',
    '.ne-panel{color:red}',
    'narduk-shell contributes 1 card(s), each shipped beside its component.',
  )
  assert.match(rendered.files['cards/ne-state-panel.html']!, /@dsCard group="Shell"/)
  assert.match(rendered.files['cards/ne-state-panel.html']!, /class="ne-panel"/)
  assert.match(rendered.files['index.html']!, /narduk-shell contributes 1 card\(s\)/)
  assert.deepEqual(
    rendered.cards.map((preview) => preview.group),
    ['Shell'],
  )
})
