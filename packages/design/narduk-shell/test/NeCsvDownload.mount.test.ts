// @vitest-environment happy-dom
/*
 * NeCsvDownload, mounted (narduk-libs#528): a click saves exactly the rows it
 * was given, through an object URL, and hands the same text to `download`.
 */
import { mount } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'

import NeCsvDownload from '../src/runtime/components/NeCsvDownload.vue'

afterEach(() => {
  vi.restoreAllMocks()
})

describe('NeCsvDownload', () => {
  it('saves the rows in view as <filename>.csv and emits the text', async () => {
    const create = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:csv')
    const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})

    const wrapper = mount(NeCsvDownload, {
      props: {
        columns: [
          { key: 'time', label: 'Time' },
          { key: 'wind', label: 'Wind', unit: 'kt' },
        ],
        filename: 'history',
        preamble: ['Source: NOAA NDBC'],
        rows: [
          { time: '1:50 PM', wind: 14 },
          { time: '12:50 PM', wind: null },
        ],
      },
    })

    expect(wrapper.text()).toContain('CSV')
    expect(wrapper.get('button').attributes('aria-label')).toBe('Download 2 rows as CSV')
    await wrapper.get('button').trigger('click')

    expect(wrapper.emitted('download')).toEqual([
      ['Source: NOAA NDBC\r\nTime,Wind (kt)\r\n1:50 PM,14\r\n12:50 PM,\r\n', 'history.csv'],
    ])
    expect(create).toHaveBeenCalledOnce()
    expect(click).toHaveBeenCalledOnce()
    expect(revoke).toHaveBeenCalledWith('blob:csv')
    expect(document.querySelector('a[download]')).toBeNull()
  })

  it('keeps a filename that already ends in .csv', async () => {
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:csv')
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    const wrapper = mount(NeCsvDownload, {
      props: { columns: [{ key: 'a', label: 'A' }], filename: 'Rows.CSV', rows: [{ a: 1 }] },
    })
    await wrapper.get('button').trigger('click')
    expect(wrapper.emitted('download')![0]![1]).toBe('Rows.CSV')
    expect(wrapper.get('button').attributes('aria-label')).toBe('Download 1 row as CSV')
  })
})
