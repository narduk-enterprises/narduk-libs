// @vitest-environment happy-dom
/*
 * The `./format` design card, mounted — components backlog item 5
 * (narduk-libs#252).
 *
 * `test/design-cards.test.ts` proves every card server-renders into the three
 * attributes NE Base keys off. This file is about the one card that previews
 * an export subpath instead of a component, and it asserts the thing a
 * screenshot of the gallery is actually evidence of: that the strings on the
 * card are the strings the formatters produce right now, for the inputs the
 * card names. A card that drifted from its own module would still be a
 * perfectly valid card section, and would be worse than no card at all — a
 * designer would pick type sizes against a format the library no longer emits.
 */
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import FormattersCard from '../src/design-cards/Formatters.card.vue'
import { createFormatters, formatCompact, formatMoney, formatPercent } from '../src/format'

const AT = '2026-03-08T08:30:00Z'
const NOW = '2026-03-08T11:30:00Z'
const chicago = createFormatters({ timeZone: 'America/Chicago', locale: 'en-US' })

describe('the formatters card', () => {
  it('renders the card section NE Base consumes', () => {
    const wrapper = mount(FormattersCard)
    const section = wrapper.get('[data-design-card="formatters"]')

    expect(section.attributes('data-name')).toBe('Formatters')
    expect(section.attributes('data-group')).toBe('Shell')
    expect(section.classes()).toContain('preview-card')
  })

  it('shows what each formatter returns, not a transcription of what it once returned', () => {
    const text = mount(FormattersCard).text()

    // Computed here, from the same module, rather than pasted: if the card
    // and the module disagree, one of them changed and this fails.
    expect(text).toContain(chicago.formatDateTime(AT))
    expect(text).toContain(chicago.formatDateTime(AT, { timeZone: 'Asia/Tokyo' }))
    expect(text).toContain(chicago.formatRelative(AT, { now: NOW }))
    expect(text).toContain(formatCompact(1_234_567, { locale: 'en-US' }))
    expect(text).toContain(formatMoney(1234.5, { locale: 'en-US', currency: 'USD' }))
    expect(text).toContain(formatPercent(0.055, { locale: 'en-US' }))
  })

  it('is a gate that can fail: those values are distinctive, not substrings of the labels', () => {
    // Every assertion above would pass vacuously if the card printed its own
    // source. Pin two outputs that appear nowhere in the call labels.
    const text = mount(FormattersCard).text()

    expect(text).toContain('Mar 8, 2026, 3:30 AM CDT')
    expect(text).toContain('1,234 cfs')
  })

  it('fills every value cell, because a blank one still renders a plausible card', () => {
    // The labels are `<code>`; the outputs are `<span>`. Read only the outputs
    // -- `formatDate(undefined)` is a label that legitimately says "undefined".
    const values = mount(FormattersCard)
      .findAll('span.mono')
      .map((cell) => cell.text())

    expect(values.length).toBeGreaterThanOrEqual(14)
    for (const value of values) {
      expect(value).not.toBe('')
      expect(value).not.toContain('undefined')
      expect(value).not.toContain('NaN')
      expect(value).not.toContain('[object')
    }
  })

  it('shows one instant twice, which is the argument for a required timeZone', () => {
    const text = mount(FormattersCard).text()

    // Same instant, two zones, two strings. A host-timezone default would
    // make which one a reader sees depend on where the reader is sitting.
    expect(text).toContain('Mar 8, 2026, 3:30 AM')
    expect(text).toContain('Mar 8, 2026, 5:30 PM')
  })

  it('renders the placeholder for a missing value rather than an empty cell', () => {
    expect(mount(FormattersCard).text()).toContain('—')
  })
})
