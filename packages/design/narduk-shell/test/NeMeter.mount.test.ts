// @vitest-environment happy-dom
import { mount } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'

import NeMeter from '../src/runtime/components/NeMeter.vue'
import { isUnreported, NE_UNREPORTED_TEXT, type NeMeterProps } from '../src/index'
import { readMeter, readMeterSegments } from '../src/runtime/components/ne-meter-types'

function mountMeter(props: NeMeterProps) {
  return mount(NeMeter, { props })
}

/** The fill's inline width, e.g. `84%`, or `null` when there is no fill. */
function fillWidth(wrapper: ReturnType<typeof mountMeter>): string | null {
  const fill = wrapper.find('.ne-meter__fill')
  return fill.exists() ? (fill.element as HTMLElement).style.width : null
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('isUnreported', () => {
  it('is true only when nothing produced a number', () => {
    for (const value of [null, undefined, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(isUnreported(value)).toBe(true)
    }
    for (const value of [0, -1, 4200, '', '—', '$0.00']) {
      expect(isUnreported(value)).toBe(false)
    }
  })
})

describe('readMeter', () => {
  it('reads a value inside the range as its fraction of the ceiling', () => {
    expect(readMeter(4200, 5000)).toEqual({
      reported: true,
      ceiling: 5000,
      now: 4200,
      fraction: 0.84,
    })
  })

  it('clamps geometry to [0, max]', () => {
    expect(readMeter(6000, 5000)).toMatchObject({ now: 5000, fraction: 1 })
    expect(readMeter(-20, 5000)).toMatchObject({ now: 0, fraction: 0 })
    expect(readMeter(Number.POSITIVE_INFINITY, 5000)).toMatchObject({ reported: false })
  })

  it('treats a missing or non-finite value as unreported, never as zero', () => {
    for (const value of [null, undefined, Number.NaN]) {
      expect(readMeter(value, 5000)).toEqual({
        reported: false,
        ceiling: 5000,
        now: null,
        fraction: null,
      })
    }
  })

  it('gives a ceiling of zero or less no room: 0 is empty, anything above it is full', () => {
    expect(readMeter(0, 0)).toMatchObject({ reported: true, ceiling: 0, now: 0, fraction: 0 })
    expect(readMeter(3, 0)).toMatchObject({ reported: true, ceiling: 0, now: 0, fraction: 1 })
    expect(readMeter(3, -10)).toMatchObject({ ceiling: 0, fraction: 1 })
    expect(readMeter(3, Number.NaN)).toMatchObject({ ceiling: 0, fraction: 1 })
  })
})

describe('NeMeter, reported', () => {
  it('fills the track to the value and shows the figure beside it', () => {
    const wrapper = mountMeter({ value: 4200, max: 5000, label: 'Core REST' })

    expect(fillWidth(wrapper)).toBe('84%')
    expect(wrapper.get('.ne-meter__label').text()).toBe('Core REST')
    expect(wrapper.get('.ne-meter__figure').text()).toBe('4,200 / 5,000')
    expect(wrapper.attributes('data-state')).toBe('reported')
    expect(wrapper.classes()).not.toContain('ne-meter--unreported')
  })

  it('is a meter with its range, named by its label', () => {
    const root = mountMeter({ value: 4200, max: 5000, label: 'Core REST' })
    expect(root.attributes('role')).toBe('meter')
    expect(root.attributes('aria-label')).toBe('Core REST')
    expect(root.attributes('aria-valuemin')).toBe('0')
    expect(root.attributes('aria-valuemax')).toBe('5000')
    expect(root.attributes('aria-valuenow')).toBe('4200')
    expect(root.attributes('aria-valuetext')).toBe('4,200 of 5,000')
  })

  it('renders a reported zero as a genuinely empty track, not the hatch', () => {
    const wrapper = mountMeter({ value: 0, max: 5000 })
    expect(fillWidth(wrapper)).toBe('0%')
    expect(wrapper.attributes('data-state')).toBe('reported')
    expect(wrapper.attributes('aria-valuenow')).toBe('0')
    expect(wrapper.get('.ne-meter__value').text()).toBe('0')
  })

  it('clamps the fill but never the figure: an overrun still says what it is', () => {
    const over = mountMeter({ value: 5400, max: 5000 })
    expect(fillWidth(over)).toBe('100%')
    expect(over.get('.ne-meter__value').text()).toBe('5,400')
    expect(over.attributes('aria-valuenow')).toBe('5000')
    expect(over.attributes('aria-valuetext')).toBe('5,400 of 5,000')

    const under = mountMeter({ value: -12, max: 5000 })
    expect(fillWidth(under)).toBe('0%')
    expect(under.get('.ne-meter__value').text()).toBe('-12')
    expect(under.attributes('aria-valuenow')).toBe('0')
  })

  it('handles a ceiling with no room without dividing by zero', () => {
    const empty = mountMeter({ value: 0, max: 0 })
    expect(fillWidth(empty)).toBe('0%')
    expect(empty.attributes('aria-valuemax')).toBe('0')

    const full = mountMeter({ value: 3, max: 0 })
    expect(fillWidth(full)).toBe('100%')
    expect(full.get('.ne-meter__figure').text()).toBe('3 / 0')
  })

  it('falls back to its own reading for a name when there is no label', () => {
    const wrapper = mountMeter({ value: 4200, max: 5000 })
    expect(wrapper.find('.ne-meter__label').exists()).toBe(false)
    expect(wrapper.attributes('aria-label')).toBe('4,200 of 5,000')
  })
})

describe('NeMeter, unreported (narduk-libs#602)', () => {
  const unreported: Array<[string, NeMeterProps]> = [
    ['null', { value: null, max: 5000, label: 'Core REST' }],
    ['undefined', { value: undefined, max: 5000, label: 'Core REST' }],
    ['omitted', { max: 5000, label: 'Core REST' }],
    ['NaN', { value: Number.NaN, max: 5000, label: 'Core REST' }],
  ]

  it.each(unreported)('renders %s as the hatch, with no fill at all', (_name, props) => {
    const wrapper = mountMeter(props)
    expect(wrapper.classes()).toContain('ne-meter--unreported')
    expect(wrapper.attributes('data-state')).toBe('unreported')
    // Neither a full bar nor an empty one: there is no fill element to size.
    expect(wrapper.find('.ne-meter__fill').exists()).toBe(false)
    expect(wrapper.find('.ne-meter__track').exists()).toBe(true)
  })

  it.each(unreported)('shows %s as an em-dash figure, never 0', (_name, props) => {
    const wrapper = mountMeter(props)
    expect(wrapper.get('.ne-meter__value').text()).toBe('—')
    expect(wrapper.get('.ne-meter__figure').text()).toBe('— / 5,000')
    expect(wrapper.text()).not.toMatch(/\b0\b/)
  })

  it.each(unreported)(
    'names %s as not reported, with no aria-valuenow to misread',
    (_name, props) => {
      const wrapper = mountMeter(props)
      expect(wrapper.attributes('role')).toBe('img')
      expect(wrapper.attributes('aria-label')).toBe('Core REST: not reported')
      expect(wrapper.attributes('aria-valuenow')).toBeUndefined()
      expect(wrapper.attributes('aria-valuetext')).toBeUndefined()
    },
  )

  it('says only "Not reported" when there is no label to prefix', () => {
    const wrapper = mountMeter({ value: null, max: 5000 })
    expect(wrapper.attributes('aria-label')).toBe(NE_UNREPORTED_TEXT)
    expect(NE_UNREPORTED_TEXT).toBe('Not reported')
  })

  it('keeps the same footprint as a reported meter, so a row never reflows', () => {
    const reported = mountMeter({ value: 1, max: 2, label: 'A' })
    const missing = mountMeter({ value: null, max: 2, label: 'A' })
    const shape = (wrapper: ReturnType<typeof mountMeter>) =>
      [...wrapper.element.children].map((child) => child.className)
    expect(shape(missing)).toEqual(shape(reported))
  })

  it('accepts null without a Vue prop warning', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    mountMeter({ value: null, max: 5000 })
    mountMeter({ value: undefined, max: 5000 })
    expect(warn).not.toHaveBeenCalled()
  })
})

describe('NeMeter variants', () => {
  it('defaults to block', () => {
    expect(mountMeter({ value: 1, max: 2 }).classes()).toContain('ne-meter--block')
  })

  it('renders inline as one row of label, track and figure, in that order', () => {
    const wrapper = mountMeter({ value: 1, max: 2, label: 'Headroom', variant: 'inline' })
    expect(wrapper.classes()).toContain('ne-meter--inline')
    expect([...wrapper.element.children].map((child) => child.className)).toEqual([
      expect.stringContaining('ne-meter__label'),
      expect.stringContaining('ne-meter__track'),
      expect.stringContaining('ne-meter__figure'),
    ])
  })

  it('keeps the unreported treatment in the inline variant too', () => {
    const wrapper = mountMeter({ value: null, max: 2, variant: 'inline' })
    expect(wrapper.classes()).toEqual(
      expect.arrayContaining(['ne-meter--inline', 'ne-meter--unreported']),
    )
  })
})

describe('readMeterSegments', () => {
  it('fills the track in order and sums the real values', () => {
    const reading = readMeterSegments([{ value: 40 }, { value: 20, tone: 'warn' }], 100)
    expect(reading).toMatchObject({ ceiling: 100, reported: true, total: 60 })
    expect(reading.segments.map((part) => part.fraction)).toEqual([0.4, 0.2])
    expect(reading.segments.map((part) => part.tone)).toEqual(['accent', 'warn'])
  })

  it('clamps an overrun to the track but keeps the real total', () => {
    const reading = readMeterSegments([{ value: 80 }, { value: 50 }, { value: 10 }], 100)
    expect(reading.segments.map((part) => part.fraction)).toEqual([0.8, 0.2, 0])
    expect(reading.total).toBe(140)
  })

  it('draws an unreported part as nothing and does not count it as zero', () => {
    const reading = readMeterSegments([{ value: 30 }, { value: null }, { value: 10 }], 100)
    expect(reading.segments.map((part) => [part.reported, part.value, part.fraction])).toEqual([
      [true, 30, 0.3],
      [false, null, 0],
      [true, 10, 0.1],
    ])
    expect(reading.total).toBe(40)
  })

  it('is unreported when no part is, or there are none', () => {
    expect(readMeterSegments([{ value: null }, { value: Number.NaN }], 100)).toMatchObject({
      reported: false,
      total: null,
    })
    expect(readMeterSegments([], 100)).toMatchObject({ reported: false, total: null })
  })

  it('divides by nothing when the ceiling has no room', () => {
    const reading = readMeterSegments([{ value: 3 }, { value: 2 }], 0)
    expect(reading.segments.map((part) => part.fraction)).toEqual([1, 0])
  })
})

describe('NeMeter segments', () => {
  const SEGMENTS = [
    { label: 'Used', value: 40, tone: 'warn' },
    { label: 'Cache', value: 20 },
  ] as const

  it('draws one part per reported segment, widths from the ceiling', () => {
    const wrapper = mountMeter({ segments: SEGMENTS, max: 100, label: 'Disk' })
    const parts = wrapper.findAll('[data-ne-meter-segment]')

    expect(wrapper.classes()).toContain('ne-meter--segmented')
    expect(parts.map((part) => (part.element as HTMLElement).style.width)).toEqual(['40%', '20%'])
    expect(parts.map((part) => part.classes())).toEqual([
      expect.arrayContaining(['ne-meter__segment--warn']),
      expect.arrayContaining(['ne-meter__segment--accent']),
    ])
    expect(parts.map((part) => part.attributes('title'))).toEqual(['Used', 'Cache'])
    expect(wrapper.find('.ne-meter__fill').exists()).toBe(false)
  })

  it('shows the summed figure against the ceiling', () => {
    const wrapper = mountMeter({ segments: SEGMENTS, max: 100 })
    expect(wrapper.get('.ne-meter__value').text()).toBe('60')
    expect(wrapper.get('.ne-meter__ceiling').text()).toBe('/ 100')
  })

  it('is one image whose name lists every part, not a meter with one value', () => {
    const wrapper = mountMeter({ segments: SEGMENTS, max: 100, label: 'Disk' })
    expect(wrapper.attributes('role')).toBe('img')
    expect(wrapper.attributes('aria-label')).toBe('Disk: Used 40, Cache 20 of 100')
    expect(wrapper.attributes('aria-valuenow')).toBeUndefined()
    expect(wrapper.attributes('data-state')).toBe('reported')
  })

  it('names an unreported part and draws nothing for it', () => {
    const wrapper = mountMeter({
      segments: [
        { label: 'Used', value: 40 },
        { label: 'Cache', value: null },
      ],
      max: 100,
    })
    expect(wrapper.findAll('[data-ne-meter-segment]')).toHaveLength(1)
    expect(wrapper.attributes('aria-label')).toBe('Used 40, Cache not reported of 100')
  })

  it('takes the unreported treatment when no part is reported', () => {
    const wrapper = mountMeter({ segments: [{ value: null }], max: 100, label: 'Disk' })
    expect(wrapper.attributes('data-state')).toBe('unreported')
    expect(wrapper.attributes('aria-label')).toBe('Disk: not reported')
    expect(wrapper.findAll('[data-ne-meter-segment]')).toHaveLength(0)
    expect(wrapper.get('.ne-meter__value').text()).toBe('—')
  })

  it('ignores `value` in segment mode, and leaves the single reading unchanged without it', () => {
    const segmented = mountMeter({ segments: SEGMENTS, value: 99, max: 100 })
    expect(segmented.get('.ne-meter__value').text()).toBe('60')
    const single = mountMeter({ value: 99, max: 100 })
    expect(single.classes()).not.toContain('ne-meter--segmented')
    expect(single.attributes('role')).toBe('meter')
    expect(fillWidth(single)).toBe('99%')
  })
})
