/**
 * useShare policy (narduk-libs#994): share when the sheet exists and accepts
 * the data, treat a cancel as a cancel (never a clipboard write), fall back to
 * the clipboard on any other share failure, report a clipboard refusal.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { effectScope } from 'vue'

import { createSharer, useShare } from '../runtime/app/share'

import type { ShareNavigator } from '../runtime/app/share'

const content = { title: 'Station 42', text: 'Swell 1.4 m', url: 'https://buoys.test/42' }

function domError(name: string): Error {
  const error = new Error(name)
  error.name = name
  return error
}

function fakeNavigator(overrides: Partial<ShareNavigator> = {}) {
  const writeText = vi.fn<(text: string) => Promise<void>>().mockResolvedValue()
  const nav: ShareNavigator = { clipboard: { writeText }, ...overrides }
  return { nav, writeText }
}

describe('createSharer().share', () => {
  it('shares through the sheet and does not copy', async () => {
    const share = vi.fn().mockResolvedValue(undefined)
    const { nav, writeText } = fakeNavigator({ share })
    await expect(createSharer(() => nav).share(content)).resolves.toBe('shared')
    expect(share).toHaveBeenCalledWith(content)
    expect(writeText).not.toHaveBeenCalled()
  })

  it('calls share as a method of the navigator', async () => {
    const nav = fakeNavigator().nav
    nav.share = vi.fn(function (this: unknown) {
      return this === nav ? Promise.resolve() : Promise.reject(new TypeError('Illegal invocation'))
    })
    await expect(createSharer(() => nav).share(content)).resolves.toBe('shared')
  })

  it('treats a dismissed sheet as cancelled and leaves the clipboard alone', async () => {
    // ogpreview-app fell through to the clipboard here and overwrote it.
    const { nav, writeText } = fakeNavigator({
      share: vi.fn().mockRejectedValue(domError('AbortError')),
    })
    await expect(createSharer(() => nav).share(content)).resolves.toBe('cancelled')
    expect(writeText).not.toHaveBeenCalled()
  })

  it.each(['NotAllowedError', 'TypeError', 'DataError'])(
    'falls back to copying the URL after a %s',
    async (name) => {
      // buoys treated every error as a cancel; imessage-dictionary reported failure.
      const { nav, writeText } = fakeNavigator({
        share: vi.fn().mockRejectedValue(domError(name)),
      })
      await expect(createSharer(() => nav).share(content)).resolves.toBe('copied')
      expect(writeText).toHaveBeenCalledWith(content.url)
    },
  )

  it('copies when there is no share sheet', async () => {
    const { nav, writeText } = fakeNavigator()
    await expect(createSharer(() => nav).share(content)).resolves.toBe('copied')
    expect(writeText).toHaveBeenCalledWith(content.url)
  })

  it('copies instead of sharing when canShare refuses the data', async () => {
    const share = vi.fn().mockResolvedValue(undefined)
    const { nav, writeText } = fakeNavigator({ canShare: () => false, share })
    await expect(createSharer(() => nav).share(content)).resolves.toBe('copied')
    expect(share).not.toHaveBeenCalled()
    expect(writeText).toHaveBeenCalledOnce()
  })

  it('copies text and URL with fallback: text+url', async () => {
    const { nav, writeText } = fakeNavigator()
    await createSharer(() => nav).share(content, { fallback: 'text+url' })
    expect(writeText).toHaveBeenCalledWith('Swell 1.4 m https://buoys.test/42')
  })

  it('copies the text when there is no URL', async () => {
    const { nav, writeText } = fakeNavigator()
    await createSharer(() => nav).share({ text: 'hello' })
    expect(writeText).toHaveBeenCalledWith('hello')
  })

  it('answers failed without copying when fallback is false', async () => {
    const { nav, writeText } = fakeNavigator({
      share: vi.fn().mockRejectedValue(domError('NotAllowedError')),
    })
    await expect(createSharer(() => nav).share(content, { fallback: false })).resolves.toBe(
      'failed',
    )
    expect(writeText).not.toHaveBeenCalled()
  })

  it('answers failed when the clipboard refuses too', async () => {
    const { nav, writeText } = fakeNavigator()
    writeText.mockRejectedValue(domError('NotAllowedError'))
    await expect(createSharer(() => nav).share(content)).resolves.toBe('failed')
  })

  it('answers failed on the server', async () => {
    await expect(createSharer(() => {}).share(content)).resolves.toBe('failed')
    await expect(createSharer(() => {}).copy('x')).resolves.toBe('failed')
  })
})

describe('useShare', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('flags copied for copiedFor ms after a copy, restarting on a second copy', async () => {
    const { nav } = fakeNavigator()
    const scope = effectScope()
    const api = scope.run(() => useShare({ copiedFor: 1000 }, () => nav))!

    await expect(api.copy('x')).resolves.toBe('copied')
    expect(api.copied.value).toBe(true)
    vi.advanceTimersByTime(600)
    await api.share(content)
    vi.advanceTimersByTime(600)
    expect(api.copied.value).toBe(true)
    vi.advanceTimersByTime(400)
    expect(api.copied.value).toBe(false)
    scope.stop()
  })

  it('does not flag copied after a share or a cancel', async () => {
    const { nav } = fakeNavigator({ share: vi.fn().mockRejectedValue(domError('AbortError')) })
    const api = useShare({}, () => nav)
    await expect(api.share(content)).resolves.toBe('cancelled')
    expect(api.copied.value).toBe(false)
  })

  it('clears its timer when the scope is disposed', async () => {
    const { nav } = fakeNavigator()
    const scope = effectScope()
    const api = scope.run(() => useShare({}, () => nav))!
    await api.copy('x')
    scope.stop()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('reports canNativeShare false until mount', () => {
    const api = useShare({}, () => fakeNavigator({ share: vi.fn() }).nav)
    expect(api.canNativeShare.value).toBe(false)
  })
})
