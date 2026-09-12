// @vitest-environment happy-dom
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import { defineComponent, h } from 'vue'

import NeKpiTile from '../src/runtime/components/NeKpiTile.vue'

import type { NeNumberOptions } from '../src/format'
import type { NeStatusTone } from '../src/runtime/utils/status-map'

/**
 * A stand-in for Nuxt UI's `UCard`. `NeKpiTile.vue` writes a bare `<UCard>`
 * tag rather than a static import -- this package type-checks and tests
 * standalone, with no live Nuxt app of its own to resolve `Card.vue`'s
 * build-time-only `#build/ui/card` and `#imports` specifiers (see the
 * component's own header comment) -- so these tests register this fake under
 * the same global name, the way a real Nuxt app registers the real thing. It
 * just forwards attrs and the default slot, which is all NeKpiTile needs.
 */
const FakeUCard = defineComponent({
  name: 'UCard',
  setup(_props, { attrs, slots }) {
    return () => h('div', { ...attrs }, slots.default?.())
  },
})

interface KpiTileTestProps {
  label: string
  value: number | string | null | undefined
  valueOptions?: NeNumberOptions
  delta?: number | string | null
  detail?: string
  tone?: NeStatusTone
}

function mountTile(props: KpiTileTestProps, slots: Record<string, () => unknown> = {}) {
  return mount(NeKpiTile, {
    props,
    slots,
    global: { components: { UCard: FakeUCard } },
  })
}

describe('NeKpiTile', () => {
  it('renders the label', () => {
    const wrapper = mountTile({ label: 'Runners online', value: 128 })
    expect(wrapper.text()).toContain('Runners online')
  })

  it('formats a numeric value through formatNumber, not toLocaleString', () => {
    const wrapper = mountTile({ label: 'Runners online', value: 12345 })
    expect(wrapper.get('.ne-kpi-tile__value').text()).toBe('12,345')
  })

  it('renders a null value as the formatter empty placeholder', () => {
    const wrapper = mountTile({ label: 'Runners online', value: null })
    expect(wrapper.get('.ne-kpi-tile__value').text()).toBe('—')
  })

  it('passes a string value through unchanged, with no formatting applied', () => {
    const wrapper = mountTile({ label: 'Spend', value: '$1,234.00' })
    expect(wrapper.get('.ne-kpi-tile__value').text()).toBe('$1,234.00')
  })

  it('renders no delta or detail row when neither is given', () => {
    const wrapper = mountTile({ label: 'Runners online', value: 128 })
    expect(wrapper.find('.ne-kpi-tile__meta').exists()).toBe(false)
  })

  it('formats a positive numeric delta with an explicit sign and an up glyph', () => {
    const wrapper = mountTile({ label: 'Runners online', value: 128, delta: 6 })
    const delta = wrapper.get('[data-testid="ne-kpi-tile-delta"]')
    expect(delta.text()).toBe('▲ +6')
  })

  it('formats a negative numeric delta with an explicit sign and a down glyph', () => {
    const wrapper = mountTile({ label: 'Open findings', value: 42, delta: -3 })
    const delta = wrapper.get('[data-testid="ne-kpi-tile-delta"]')
    expect(delta.text()).toBe('▼ -3')
  })

  it('formats a zero delta with an explicit sign and no glyph', () => {
    const wrapper = mountTile({ label: 'Queue depth', value: 0, delta: 0 })
    const delta = wrapper.get('[data-testid="ne-kpi-tile-delta"]')
    expect(delta.text()).toBe('+0')
  })

  it('renders a string delta as-is, with no glyph and no reformatting', () => {
    const wrapper = mountTile({ label: 'Spend', value: 100, delta: 'flat' })
    const delta = wrapper.get('[data-testid="ne-kpi-tile-delta"]')
    expect(delta.text()).toBe('flat')
  })

  it('renders the detail caption alongside the delta', () => {
    const wrapper = mountTile({
      label: 'Runners online',
      value: 128,
      delta: 6,
      detail: 'vs yesterday',
    })
    expect(wrapper.get('.ne-kpi-tile__detail').text()).toBe('vs yesterday')
  })

  it('renders the detail caption even with no delta given', () => {
    const wrapper = mountTile({ label: 'Runners online', value: 128, detail: 'no change data' })
    expect(wrapper.get('.ne-kpi-tile__detail').text()).toBe('no change data')
    expect(wrapper.find('[data-testid="ne-kpi-tile-delta"]').exists()).toBe(false)
  })

  it('renders the #spark slot when given', () => {
    const wrapper = mountTile(
      { label: 'Runners online', value: 128 },
      { spark: () => h('div', { 'data-testid': 'fake-spark' }) },
    )
    expect(wrapper.find('[data-testid="fake-spark"]').exists()).toBe(true)
  })

  it('renders no spark wrapper when the slot is not given', () => {
    const wrapper = mountTile({ label: 'Runners online', value: 128 })
    expect(wrapper.find('.ne-kpi-tile__spark').exists()).toBe(false)
  })

  it('colours the delta by tone, defaulting to muted when no tone is given', () => {
    const wrapper = mountTile({ label: 'Runners online', value: 128, delta: 6 })
    const delta = wrapper.get('[data-testid="ne-kpi-tile-delta"]')
    expect(delta.classes()).toContain('text-muted')
  })

  const toneColors: Array<[NeStatusTone, string]> = [
    ['ok', 'text-success'],
    ['warn', 'text-warning'],
    ['error', 'text-error'],
    ['info', 'text-info'],
    ['neutral', 'text-muted'],
    ['pending', 'text-muted'],
  ]

  for (const [tone, className] of toneColors) {
    it(`maps tone "${tone}" to the delta colour class "${className}"`, () => {
      const wrapper = mountTile({ label: 'Runners online', value: 128, delta: 6, tone })
      const delta = wrapper.get('[data-testid="ne-kpi-tile-delta"]')
      expect(delta.classes()).toContain(className)
    })
  }

  /*
   * The done-when proof that colour is never the only signal: strip every
   * tone-driven colour class away by reading only the delta's text content,
   * and the direction still reads the same. A tone changes `class`; it must
   * never change what the delta *says*.
   */
  it('keeps the delta text identical across every tone -- colour is never the only signal', () => {
    const tones: Array<NeStatusTone | undefined> = [
      undefined,
      'ok',
      'warn',
      'error',
      'info',
      'neutral',
      'pending',
    ]
    const texts = tones.map((tone) => {
      const wrapper = mountTile({ label: 'Runners online', value: 128, delta: 6, tone })
      return wrapper.get('[data-testid="ne-kpi-tile-delta"]').text()
    })
    expect(new Set(texts).size).toBe(1)
    expect(texts[0]).toBe('▲ +6')

    const negativeTexts = tones.map((tone) => {
      const wrapper = mountTile({ label: 'Open findings', value: 42, delta: -3, tone })
      return wrapper.get('[data-testid="ne-kpi-tile-delta"]').text()
    })
    expect(new Set(negativeTexts).size).toBe(1)
    expect(negativeTexts[0]).toBe('▼ -3')
  })

  it('forwards valueOptions to formatNumber for the value', () => {
    const wrapper = mountTile({
      label: 'Spend',
      value: 1234.5,
      valueOptions: { minimumFractionDigits: 2, maximumFractionDigits: 2 },
    })
    expect(wrapper.get('.ne-kpi-tile__value').text()).toBe('1,234.50')
  })
})
