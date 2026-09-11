/*
 * The `./format` design card, server-rendered — components backlog item 5
 * (narduk-libs#252).
 *
 * design-system-build prerenders the gallery with `nuxt generate`, so this is
 * the render that reaches NE Base; a card that only works after hydration
 * produces an empty card there while every DOM test stays green. That much
 * `test/design-cards.test.ts` already covers for every card.
 *
 * What is specific to this one is byte stability. `check:package` re-renders
 * the built bundle and compares it to the shipped bytes, so a card whose
 * output moved between two renders fails that gate — and the obvious way for a
 * *formatting* card to do that is to read the clock or the host zone. This
 * file renders it twice and requires the same bytes, and reads the card source
 * for the two things that would break it.
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'
import { createSSRApp } from 'vue'
import { renderToString } from 'vue/server-renderer'

import FormattersCard from '../src/design-cards/Formatters.card.vue'

const source = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), '../src/design-cards/Formatters.card.vue'),
  'utf8',
)
const script = source.slice(0, source.indexOf('</script>'))

const render = () => renderToString(createSSRApp(FormattersCard))

describe('the formatters card on the server', () => {
  it('renders without a DOM, which is what `nuxt generate` gives it', async () => {
    expect(typeof document).toBe('undefined')

    const html = await render()

    expect(html).toContain('data-design-card="formatters"')
    expect(html).toContain('data-name="Formatters"')
    expect(html).toContain('data-group="Shell"')
    expect(html.length).toBeGreaterThan(600)
  })

  it('renders the formatted values on the server, not just the labels', async () => {
    const html = await render()

    expect(html).toContain('Mar 8, 2026, 3:30 AM CDT')
    expect(html).toContain('Mar 8, 2026, 5:30 PM')
    expect(html).toContain('3 hours ago')
    expect(html).toContain('1,234 cfs')
    expect(html).toContain('1h 30m')
  })

  it('renders byte-identically twice, which is what check:package compares', async () => {
    expect(await render()).toBe(await render())
  })

  it('carries no ambient clock and no host zone in its own source', () => {
    // The formatters cannot read either (test/format.ssr.test.ts proves that
    // in a child process under several TZ and LC_ALL settings). The card is
    // the remaining place a clock could get in, by passing one as an argument.
    expect(script).not.toMatch(/\bDate\.now\b/)
    expect(script).not.toMatch(/\bnew Date\(\s*\)/)
    expect(script).not.toMatch(/resolvedOptions\s*\(\s*\)/)
    expect(script).not.toMatch(/navigator\.languages?/)
  })

  it('names its zone and locale explicitly, so the gallery is not rendered from the builder', () => {
    expect(script).toContain("timeZone: 'America/Chicago'")
    expect(script).toContain("locale: 'en-US'")
  })
})
