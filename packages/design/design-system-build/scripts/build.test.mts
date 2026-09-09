import assert from 'node:assert/strict'
import test from 'node:test'
import { galleryCoverage, renderBundle, splitStyles } from './build.mts'
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
