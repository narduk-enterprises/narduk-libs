import { describe, expect, it } from 'vitest'

import { clamp, median } from '../runtime/shared/utils/numbers'
import {
  escapeRegExp,
  initials,
  ordinal,
  plural,
  pluralWord,
  slugify,
} from '../runtime/shared/utils/text'
import { zonedDateKey, zonedDateParts } from '../runtime/shared/utils/zoned-date'

describe('slugify', () => {
  it('matches the estate copies on ordinary names', () => {
    expect(slugify('Lake Travis')).toBe('lake-travis')
    expect(slugify('  Rêve -- Bleu!  ')).toBe('reve-bleu')
    expect(slugify('Salt & Pepper')).toBe('salt-and-pepper')
    expect(slugify('Ñandú 2026')).toBe('nandu-2026')
  })

  it('returns an empty string when nothing usable is left', () => {
    expect(slugify('!!!')).toBe('')
    expect(slugify('東京')).toBe('')
  })

  it('cuts to maxLength without leaving a trailing hyphen', () => {
    expect(slugify('abc def ghi', { maxLength: 4 })).toBe('abc')
    expect(slugify('abc def', { maxLength: 63 })).toBe('abc-def')
  })
})

describe('plural, ordinal, initials, escapeRegExp', () => {
  it('pluralises with a default and an irregular form', () => {
    expect(plural(1, 'lake')).toBe('1 lake')
    expect(plural(0, 'lake')).toBe('0 lakes')
    expect(plural(2, 'person', 'people')).toBe('2 people')
    expect(pluralWord(3, 'gauge')).toBe('gauges')
  })

  it('writes English ordinals, including the teens', () => {
    expect([1, 2, 3, 4, 11, 12, 13, 21, 22, 23, 101, 111].map(ordinal)).toEqual([
      '1st',
      '2nd',
      '3rd',
      '4th',
      '11th',
      '12th',
      '13th',
      '21st',
      '22nd',
      '23rd',
      '101st',
      '111th',
    ])
    expect(ordinal(1.5)).toBe('1.5')
  })

  it('takes initials from words and hyphenated names', () => {
    expect(initials('Ada Lovelace')).toBe('AL')
    expect(initials('jean-luc picard', 3)).toBe('JLP')
    expect(initials('cher')).toBe('C')
    expect(initials('  ')).toBe('')
  })

  it('escapes every RegExp metacharacter', () => {
    const literal = 'a.b*c?(d)[e]{f}^$|\\'
    expect(new RegExp(`^${escapeRegExp(literal)}$`, 'u').test(literal)).toBe(true)
  })
})

describe('clamp and median', () => {
  it('clamps into range and keeps NaN as NaN', () => {
    expect(clamp(5, 0, 10)).toBe(5)
    expect(clamp(-1, 0, 10)).toBe(0)
    expect(clamp(11, 0, 10)).toBe(10)
    expect(clamp(Number.NaN, 0, 10)).toBeNaN()
    expect(() => clamp(1, 10, 0)).toThrow(RangeError)
  })

  it('takes the median of finite values without mutating the input', () => {
    const values = [5, 1, Number.NaN, 3]
    expect(median(values)).toBe(3)
    expect(median([4, 1, 3, 2])).toBe(2.5)
    expect(median([])).toBeNull()
    expect(median([Number.POSITIVE_INFINITY])).toBeNull()
    expect(values).toEqual([5, 1, Number.NaN, 3])
  })
})

describe('zonedDateKey', () => {
  // 2026-03-08 05:30Z is 23:30 the day before in Chicago (CST, UTC-6).
  const instant = Date.parse('2026-03-08T05:30:00Z')

  it('keys the day in the named zone, not UTC', () => {
    expect(zonedDateKey(instant, 'America/Chicago')).toBe('2026-03-07')
    expect(zonedDateKey(instant, 'UTC')).toBe('2026-03-08')
  })

  it('returns wall-clock parts with a 0-23 hour and weekday', () => {
    expect(zonedDateParts(new Date(instant), 'America/Chicago')).toEqual({
      year: 2026,
      month: 3,
      day: 7,
      hour: 23,
      minute: 30,
      second: 0,
      weekday: 6,
    })
    expect(zonedDateParts(Date.parse('2026-03-08T06:00:00Z'), 'America/Chicago').hour).toBe(0)
  })

  it('fails loudly on a bad zone or instant', () => {
    expect(() => zonedDateKey(instant, 'Not/AZone')).toThrow(RangeError)
    expect(() => zonedDateKey(Number.NaN, 'UTC')).toThrow(RangeError)
  })
})
