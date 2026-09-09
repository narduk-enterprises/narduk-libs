import assert from 'node:assert/strict'
import test from 'node:test'
import { renderBundle } from './build.mts'

const card =
  '<section data-design-card="freshness" data-name="Freshness" data-group="Instruments"><span class="ns-chip">LIVE</span></section>'

test('static export keeps SSR component markup, scoped CSS and one stylesheet', () => {
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
  assert.deepEqual(JSON.parse(first.files['_ds_manifest.json']!).globalCssPaths, ['tokens.css'])
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
