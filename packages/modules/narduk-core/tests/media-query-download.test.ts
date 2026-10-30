/// <reference lib="dom" />
// @vitest-environment happy-dom
/* The DOM lib reference must stay the first line (see preferences-state.test.ts). */
import { mount } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createSSRApp, defineComponent, h, nextTick } from 'vue'
import { renderToString } from 'vue/server-renderer'

import { downloadFile } from '../runtime/app/download'
import { useMediaQuery } from '../runtime/app/media-query'

type Listener = (event: MediaQueryListEvent) => void

function stubMatchMedia(initial: boolean) {
  const listeners = new Set<Listener>()
  const list = {
    matches: initial,
    addEventListener: (_: string, listener: Listener) => listeners.add(listener),
    removeEventListener: (_: string, listener: Listener) => listeners.delete(listener),
  }
  vi.stubGlobal(
    'matchMedia',
    vi.fn(() => list),
  )
  return {
    listeners,
    fire(matches: boolean) {
      list.matches = matches
      for (const listener of listeners) listener({ matches } as MediaQueryListEvent)
    },
  }
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

const Probe = defineComponent({
  setup() {
    const phone = useMediaQuery('(max-width: 767px)')
    return () => h('p', phone.value ? 'phone' : 'desktop')
  },
})

describe('useMediaQuery', () => {
  it('renders the initial value on the server', async () => {
    stubMatchMedia(true)
    expect(await renderToString(createSSRApp(Probe))).toContain('desktop')
  })

  it('reads the query on mount, follows changes and unsubscribes on unmount', async () => {
    const media = stubMatchMedia(true)
    const wrapper = mount(Probe)
    await nextTick()
    expect(wrapper.text()).toBe('phone')
    media.fire(false)
    await nextTick()
    expect(wrapper.text()).toBe('desktop')
    wrapper.unmount()
    expect(media.listeners.size).toBe(0)
  })

  it('reads immediately outside a component', () => {
    stubMatchMedia(true)
    expect(useMediaQuery('(max-width: 767px)').value).toBe(true)
  })
})

describe('downloadFile', () => {
  it('clicks a temporary anchor and revokes the URL on the next task', () => {
    vi.useFakeTimers()
    const create = vi.fn((_blob: Blob) => 'blob:fake')
    const revoke = vi.fn()
    vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: create, revokeObjectURL: revoke }))
    const clicks: string[] = []
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
      this: HTMLAnchorElement,
    ) {
      clicks.push(this.download)
    })

    expect(downloadFile('rows.csv', 'a,b\n1,2\n', 'text/csv')).toBe(true)
    expect(clicks).toEqual(['rows.csv'])
    expect(create.mock.calls[0]?.[0]).toBeInstanceOf(Blob)
    expect(document.querySelector('a[download]')).toBeNull()
    expect(revoke).not.toHaveBeenCalled()
    vi.runAllTimers()
    expect(revoke).toHaveBeenCalledWith('blob:fake')
    click.mockRestore()
  })
})
