import { createMapKitFullscreenController, MAPKIT_FULLSCREEN_ATTRIBUTE } from '../src/client/index.js'

import type {
  MapKitFullscreenChangeEvent,
  MapKitFullscreenControllerOptions,
  MapKitFullscreenDocument,
  MapKitFullscreenElement,
  MapKitFullscreenWindow,
} from '../src/client/index.js'

/**
 * Type-level only: a real `document`, `HTMLElement`, and `window` must stay
 * assignable to the injected handles. Nothing else in a node-environment suite
 * would catch a structural shape that no longer accepts the real DOM.
 */
const realDocumentIsAccepted: MapKitFullscreenDocument = {} as Document
const realElementIsAccepted: MapKitFullscreenElement = {} as HTMLElement
const realWindowIsAccepted: MapKitFullscreenWindow = {} as Window
void realDocumentIsAccepted
void realElementIsAccepted
void realWindowIsAccepted

interface FakeDocument extends MapKitFullscreenDocument {
  body: { style: { overflow: string } }
  dispatch: (type: string, event?: unknown) => void
  documentElement: { style: { overflow: string } }
  exitCalls: number
  listenerCount: (type?: string) => number
  webkitExitCalls: number
}

function createDocument(): FakeDocument {
  const listeners = new Map<string, Set<(event: any) => void>>()

  const fake: FakeDocument = {
    addEventListener(type: string, listener: (event: any) => void): void {
      const existing = listeners.get(type) ?? new Set()
      existing.add(listener)
      listeners.set(type, existing)
    },
    body: { style: { overflow: 'scroll' } },
    dispatch(type: string, event: unknown = {}): void {
      for (const listener of [...(listeners.get(type) ?? [])]) listener(event)
    },
    documentElement: { style: { overflow: 'auto' } },
    exitCalls: 0,
    exitFullscreen(): Promise<void> {
      fake.exitCalls += 1
      // A real document clears both element references before it notifies.
      fake.fullscreenElement = null
      fake.webkitFullscreenElement = null
      fake.dispatch('fullscreenchange')
      return Promise.resolve()
    },
    fullscreenElement: null,
    listenerCount(type?: string): number {
      if (type !== undefined) return listeners.get(type)?.size ?? 0
      return [...listeners.values()].reduce((total, set) => total + set.size, 0)
    },
    removeEventListener(type: string, listener: (event: any) => void): void {
      listeners.get(type)?.delete(listener)
    },
    webkitExitCalls: 0,
    webkitExitFullscreen(): unknown {
      fake.webkitExitCalls += 1
      fake.fullscreenElement = null
      fake.webkitFullscreenElement = null
      fake.dispatch('webkitfullscreenchange')
      return undefined
    },
    webkitFullscreenElement: null,
  }

  return fake
}

/**
 * - `change`: a browser that fires `fullscreenchange` before resolving, which
 *   is what the spec requires and what every current engine does.
 * - `promise-only`: resolves without ever firing a change event.
 * - `reject`: the request is refused with a rejected promise.
 * - `throw`: the request throws synchronously.
 * - `webkit`: only the prefixed API exists, returning nothing.
 * - `silent-webkit`: the prefixed API returns nothing and never succeeds, which
 *   is reported through `webkitfullscreenerror`.
 * - `none`: no fullscreen API at all, as on iPhone Safari.
 */
type NativeBehavior =
  | 'change'
  | 'none'
  | 'promise-only'
  | 'reject'
  | 'silent-webkit'
  | 'throw'
  | 'webkit'

interface FakeElement extends MapKitFullscreenElement {
  attribute: () => string | null
  requests: number
  style: { cssText: string }
}

function createElement(
  document: FakeDocument,
  options: { cssText?: string; native?: NativeBehavior } = {},
): FakeElement {
  const attributes = new Map<string, string>()
  const native = options.native ?? 'change'

  const element: FakeElement = {
    attribute: () => attributes.get(MAPKIT_FULLSCREEN_ATTRIBUTE) ?? null,
    removeAttribute(name: string): void {
      attributes.delete(name)
    },
    requests: 0,
    setAttribute(name: string, value: string): void {
      attributes.set(name, value)
    },
    style: { cssText: options.cssText ?? '' },
  }

  if (native === 'change' || native === 'promise-only' || native === 'reject' || native === 'throw') {
    element.requestFullscreen = (): unknown => {
      element.requests += 1
      if (native === 'throw') throw new Error('fullscreen is disabled by permissions policy')
      if (native === 'reject') return Promise.reject(new Error('fullscreen request denied'))
      if (native === 'change') {
        document.fullscreenElement = element
        document.dispatch('fullscreenchange')
      }
      return Promise.resolve()
    }
  }

  if (native === 'webkit' || native === 'silent-webkit') {
    element.webkitRequestFullscreen = (): unknown => {
      element.requests += 1
      if (native === 'silent-webkit') {
        document.dispatch('webkitfullscreenerror')
        return undefined
      }
      document.webkitFullscreenElement = element
      document.dispatch('webkitfullscreenchange')
      return undefined
    }
  }

  return element
}

function setup(
  options: Partial<MapKitFullscreenControllerOptions> = {},
  element: { cssText?: string; native?: NativeBehavior } = {},
) {
  const fakeDocument = createDocument()
  const fakeElement = createElement(fakeDocument, element)
  const events: MapKitFullscreenChangeEvent[] = []
  const controller = createMapKitFullscreenController({
    document: fakeDocument,
    element: fakeElement,
    ...options,
  })
  controller.subscribe((event) => events.push(event))
  return { controller, document: fakeDocument, element: fakeElement, events }
}

function reasons(events: readonly MapKitFullscreenChangeEvent[]): string[] {
  return events.map((event) => `${event.reason}:${event.mode ?? 'none'}`)
}

describe('MapKitFullscreenController viewport mode', () => {
  it('is inert until a consumer enters', () => {
    const { controller, element, events } = setup()

    expect(controller.active).toBe(false)
    expect(controller.mode).toBeNull()
    expect(element.style.cssText).toBe('')
    expect(element.attribute()).toBeNull()
    expect(events).toEqual([])
  })

  it('defaults to viewport mode and restores the element on exit', async () => {
    const { controller, element, events } = setup({}, { cssText: 'height: 400px' })

    await controller.enter()

    expect(controller.active).toBe(true)
    expect(controller.mode).toBe('viewport')
    expect(element.attribute()).toBe('viewport')
    expect(element.style.cssText).toContain('position: fixed')
    expect(element.style.cssText).toContain('z-index: 9999')
    expect(element.requests).toBe(0)

    await controller.exit()

    expect(controller.active).toBe(false)
    expect(controller.mode).toBeNull()
    expect(element.style.cssText).toBe('height: 400px')
    expect(element.attribute()).toBeNull()
    expect(reasons(events)).toEqual(['enter:viewport', 'exit:none'])
    expect(events[0]).toMatchObject({ active: true, fallback: false, requestedMode: 'viewport' })
    expect(events[1]).toMatchObject({ active: false, fallbackCause: null, requestedMode: null })
  })

  it('appends the overlay geometry so consumer inline styles survive', async () => {
    const { controller, element } = setup({}, { cssText: 'background: black; width: 300px' })

    await controller.enter('viewport')

    expect(element.style.cssText.startsWith('background: black; width: 300px;')).toBe(true)
    // Later declarations win at equal specificity, so the overlay still sizes it.
    expect(element.style.cssText.indexOf('width: 100%')).toBeGreaterThan(
      element.style.cssText.indexOf('width: 300px'),
    )
  })

  it('honors a custom z-index', async () => {
    const { controller, element } = setup({ zIndex: 40 })

    await controller.enter()

    expect(element.style.cssText).toContain('z-index: 40;')
  })

  it('treats a second enter of the presented mode as a no-op', async () => {
    const { controller, element, events } = setup({}, { cssText: 'height: 400px' })

    await controller.enter()
    const after = element.style.cssText
    await controller.enter()
    await controller.enter('viewport')

    expect(element.style.cssText).toBe(after)
    expect(reasons(events)).toEqual(['enter:viewport'])

    // The saved cssText was not overwritten with the overlay one.
    await controller.exit()
    expect(element.style.cssText).toBe('height: 400px')
  })

  it('treats an exit while inactive as a no-op', async () => {
    const { controller, events } = setup()

    const state = await controller.exit()

    expect(state).toEqual({ active: false, mode: null })
    expect(events).toEqual([])
  })

  it('locks document scrolling and restores the previous values', async () => {
    const { controller, document } = setup()

    await controller.enter()

    expect(document.documentElement.style.overflow).toBe('hidden')
    expect(document.body.style.overflow).toBe('hidden')

    await controller.exit()

    expect(document.documentElement.style.overflow).toBe('auto')
    expect(document.body.style.overflow).toBe('scroll')
  })

  it('leaves scrolling alone when lockScroll is false', async () => {
    const { controller, document } = setup({ lockScroll: false })

    await controller.enter()

    expect(document.documentElement.style.overflow).toBe('auto')
    expect(document.body.style.overflow).toBe('scroll')
  })

  it('exits on Escape through the injected document', async () => {
    const { controller, document, element, events } = setup({}, { cssText: 'height: 400px' })

    await controller.enter()
    expect(document.listenerCount('keydown')).toBe(1)

    document.dispatch('keydown', { key: 'Escape' })

    expect(controller.active).toBe(false)
    expect(element.style.cssText).toBe('height: 400px')
    expect(document.body.style.overflow).toBe('scroll')
    expect(document.listenerCount('keydown')).toBe(0)
    expect(reasons(events)).toEqual(['enter:viewport', 'escape:none'])
  })

  it('ignores Escape when exitOnEscape is false', async () => {
    const { controller, document } = setup({ exitOnEscape: false })

    await controller.enter()

    expect(document.listenerCount('keydown')).toBe(0)
    document.dispatch('keydown', { key: 'Escape' })
    expect(controller.active).toBe(true)
  })

  it('ignores every other key', async () => {
    const { controller, document } = setup()

    await controller.enter()
    document.dispatch('keydown', { key: 'f' })
    document.dispatch('keydown', {})

    expect(controller.active).toBe(true)
  })

  it('toggles in and back out', async () => {
    const { controller, events } = setup()

    await controller.toggle()
    expect(controller.mode).toBe('viewport')

    await controller.toggle()
    expect(controller.active).toBe(false)
    expect(reasons(events)).toEqual(['enter:viewport', 'exit:none'])
  })

  it('exits on toggle even when handed a mode, because a toggle is a toggle', async () => {
    const { controller, events } = setup()

    await controller.enter('viewport')
    await controller.toggle('fullscreen')

    expect(controller.active).toBe(false)
    expect(reasons(events)).toEqual(['enter:viewport', 'exit:none'])
  })

  it('enters the configured defaultMode', async () => {
    const { controller } = setup({ defaultMode: 'fullscreen' })

    await controller.enter()

    expect(controller.mode).toBe('fullscreen')
  })
})

describe('MapKitFullscreenController native mode', () => {
  it('adopts the session from the fullscreenchange event', async () => {
    const { controller, document, element, events } = setup({}, { cssText: 'height: 400px' })

    const state = await controller.enter('fullscreen')

    expect(state).toEqual({ active: true, mode: 'fullscreen' })
    expect(element.requests).toBe(1)
    expect(element.attribute()).toBe('fullscreen')
    // Native mode sizes the element but never positions it.
    expect(element.style.cssText).toContain('height: 100%')
    expect(element.style.cssText).not.toContain('position: fixed')
    // Native fullscreen owns Escape and the page is not scrollable behind it.
    expect(document.listenerCount('keydown')).toBe(0)
    expect(document.body.style.overflow).toBe('scroll')
    // The change event and the resolved promise must not both emit.
    expect(reasons(events)).toEqual(['enter:fullscreen'])

    await controller.exit()

    expect(document.exitCalls).toBe(1)
    expect(document.fullscreenElement).toBeNull()
    expect(element.style.cssText).toBe('height: 400px')
    expect(reasons(events)).toEqual(['enter:fullscreen', 'exit:none'])
  })

  it('adopts the session when the document only resolves the promise', async () => {
    const { controller, events } = setup({}, { native: 'promise-only' })

    await controller.enter('fullscreen')

    expect(controller.mode).toBe('fullscreen')
    expect(reasons(events)).toEqual(['enter:fullscreen'])
  })

  it('supports the prefixed WebKit request', async () => {
    const { controller, element } = setup({}, { native: 'webkit' })

    expect(controller.supportsNativeFullscreen).toBe(true)
    await controller.enter('fullscreen')

    expect(controller.mode).toBe('fullscreen')
    expect(element.requests).toBe(1)
  })

  it('leaves through the prefixed exit when that is all the document has', async () => {
    const fakeDocument = createDocument()
    delete fakeDocument.exitFullscreen
    const element = createElement(fakeDocument, { native: 'webkit' })
    const controller = createMapKitFullscreenController({ document: fakeDocument, element })

    await controller.enter('fullscreen')
    await controller.exit()

    expect(fakeDocument.webkitExitCalls).toBe(1)
    expect(controller.active).toBe(false)
  })

  it('falls back to viewport when no fullscreen API exists', async () => {
    const { controller, element, events } = setup({}, { cssText: 'height: 400px', native: 'none' })

    expect(controller.supportsNativeFullscreen).toBe(false)
    const state = await controller.enter('fullscreen')

    expect(state).toEqual({ active: true, mode: 'viewport' })
    expect(element.attribute()).toBe('viewport')
    expect(element.style.cssText).toContain('position: fixed')
    expect(reasons(events)).toEqual(['fallback:viewport'])
    expect(events[0]).toMatchObject({
      active: true,
      fallback: true,
      fallbackCause: 'unsupported',
      mode: 'viewport',
      requestedMode: 'fullscreen',
    })

    await controller.exit()
    expect(element.style.cssText).toBe('height: 400px')
  })

  it('falls back to viewport when the request is rejected', async () => {
    const { controller, events } = setup({}, { native: 'reject' })

    const state = await controller.enter('fullscreen')

    expect(state).toEqual({ active: true, mode: 'viewport' })
    expect(events[0]).toMatchObject({ fallback: true, fallbackCause: 'rejected' })
  })

  it('falls back to viewport when the request throws synchronously', async () => {
    const { controller, events } = setup({}, { native: 'throw' })

    await controller.enter('fullscreen')

    expect(controller.mode).toBe('viewport')
    expect(events[0]).toMatchObject({ fallback: true, fallbackCause: 'rejected' })
  })

  it('falls back once when the document reports a fullscreenerror', async () => {
    const { controller, events } = setup({}, { native: 'silent-webkit' })

    await controller.enter('fullscreen')

    expect(controller.mode).toBe('viewport')
    expect(reasons(events)).toEqual(['fallback:viewport'])
    expect(events[0]).toMatchObject({ fallbackCause: 'rejected' })
  })

  it('ignores a fullscreenerror that arrives outside a request', async () => {
    const { controller, document, events } = setup()

    await controller.enter('viewport')
    document.dispatch('fullscreenerror')

    expect(controller.mode).toBe('viewport')
    expect(reasons(events)).toEqual(['enter:viewport'])
  })

  it('switches viewport to native with a single event', async () => {
    const { controller, document, element, events } = setup({}, { cssText: 'height: 400px' })

    await controller.enter('viewport')
    await controller.enter('fullscreen')

    expect(controller.mode).toBe('fullscreen')
    expect(element.attribute()).toBe('fullscreen')
    expect(element.style.cssText).not.toContain('position: fixed')
    // The viewport-only side effects were released by the switch.
    expect(document.body.style.overflow).toBe('scroll')
    expect(document.listenerCount('keydown')).toBe(0)
    expect(reasons(events)).toEqual(['enter:viewport', 'enter:fullscreen'])

    await controller.exit()
    expect(element.style.cssText).toBe('height: 400px')
  })

  it('switches native to viewport with a single event', async () => {
    const { controller, document, element, events } = setup({}, { cssText: 'height: 400px' })

    await controller.enter('fullscreen')
    await controller.enter('viewport')

    expect(controller.mode).toBe('viewport')
    expect(element.attribute()).toBe('viewport')
    expect(document.exitCalls).toBe(1)
    expect(document.body.style.overflow).toBe('hidden')
    expect(reasons(events)).toEqual(['enter:fullscreen', 'enter:viewport'])

    await controller.exit()
    expect(element.style.cssText).toBe('height: 400px')
  })

  it('keeps viewport mode when a switch to native fails', async () => {
    const { controller, element, events } = setup({}, { cssText: 'height: 400px', native: 'none' })

    await controller.enter('viewport')
    const state = await controller.enter('fullscreen')

    expect(state).toEqual({ active: true, mode: 'viewport' })
    expect(controller.active).toBe(true)
    expect(element.attribute()).toBe('viewport')
    expect(reasons(events)).toEqual(['enter:viewport', 'fallback:viewport'])

    await controller.exit()
    expect(element.style.cssText).toBe('height: 400px')
  })

  it('restores state when fullscreen ends outside the controller', async () => {
    const { controller, document, element, events } = setup({}, { cssText: 'height: 400px' })

    await controller.enter('fullscreen')

    // The browser's own Escape handling: the session ends, then it notifies.
    document.fullscreenElement = null
    document.dispatch('fullscreenchange')

    expect(controller.active).toBe(false)
    expect(controller.mode).toBeNull()
    expect(element.style.cssText).toBe('height: 400px')
    expect(element.attribute()).toBeNull()
    // The controller must not call exitFullscreen for a session already gone.
    expect(document.exitCalls).toBe(0)
    expect(reasons(events)).toEqual(['enter:fullscreen', 'external-exit:none'])
  })

  it('ignores a fullscreenchange for somebody else’s element', async () => {
    const { controller, document, events } = setup()

    document.fullscreenElement = { other: true }
    document.dispatch('fullscreenchange')

    expect(controller.active).toBe(false)
    expect(events).toEqual([])
  })
})

describe('MapKitFullscreenController lifecycle', () => {
  it('runs onLayout before the subscribers at every geometry change', async () => {
    const order: string[] = []
    const layoutEvents: MapKitFullscreenChangeEvent[] = []
    const { controller, document } = setup({
      onLayout: (event) => {
        order.push('layout')
        layoutEvents.push(event)
      },
    })
    controller.subscribe(() => order.push('listener'))

    await controller.enter('viewport')
    await controller.enter('fullscreen')
    document.fullscreenElement = null
    document.dispatch('fullscreenchange')

    expect(order).toEqual(['layout', 'listener', 'layout', 'listener', 'layout', 'listener'])
    expect(reasons(layoutEvents)).toEqual([
      'enter:viewport',
      'enter:fullscreen',
      'external-exit:none',
    ])
  })

  it('stops delivering to an unsubscribed listener', async () => {
    const { controller } = setup()
    const seen: string[] = []
    const unsubscribe = controller.subscribe((event) => seen.push(event.reason))

    await controller.enter()
    unsubscribe()
    await controller.exit()

    expect(seen).toEqual(['enter'])
  })

  it('restores everything when destroyed while active', async () => {
    const { controller, document, element, events } = setup({}, { cssText: 'height: 400px' })
    const listenersBefore = document.listenerCount()

    await controller.enter('viewport')
    expect(document.listenerCount()).toBeGreaterThan(listenersBefore)

    controller.destroy()

    expect(controller.destroyed).toBe(true)
    expect(controller.active).toBe(false)
    expect(element.style.cssText).toBe('height: 400px')
    expect(element.attribute()).toBeNull()
    expect(document.documentElement.style.overflow).toBe('auto')
    expect(document.body.style.overflow).toBe('scroll')
    expect(document.listenerCount()).toBe(0)
    expect(reasons(events)).toEqual(['enter:viewport', 'destroy:none'])
  })

  it('leaves native fullscreen when destroyed while presenting it', async () => {
    const { controller, document, element } = setup({}, { cssText: 'height: 400px' })

    await controller.enter('fullscreen')
    controller.destroy()

    expect(document.exitCalls).toBe(1)
    expect(element.style.cssText).toBe('height: 400px')
  })

  it('does not present the element when destroyed mid-request', async () => {
    const { controller, element, events } = setup(
      {},
      { cssText: 'height: 400px', native: 'promise-only' },
    )

    // `destroy()` lands while the request promise is still pending.
    const pending = controller.enter('fullscreen')
    controller.destroy()
    await pending

    expect(controller.active).toBe(false)
    expect(element.style.cssText).toBe('height: 400px')
    expect(element.attribute()).toBeNull()
    expect(events).toEqual([])
  })

  it('is idempotent and inert after destroy', async () => {
    const { controller, element, events } = setup()

    controller.destroy()
    controller.destroy()
    const state = await controller.enter()

    expect(state).toEqual({ active: false, mode: null })
    expect(element.style.cssText).toBe('')
    expect(events).toEqual([])
  })

  it('requires a document', () => {
    expect(() =>
      createMapKitFullscreenController({ element: createElement(createDocument()) }),
    ).toThrow(/document is required/)
  })

  it('resolves the document from an injected window', async () => {
    const fakeDocument = createDocument()
    const controller = createMapKitFullscreenController({
      element: createElement(fakeDocument),
      window: { document: fakeDocument },
    })

    await controller.enter()

    expect(fakeDocument.body.style.overflow).toBe('hidden')
    controller.destroy()
  })

  it('never reaches for a real global when handles are injected', async () => {
    // The suite runs in the node environment; a controller that fell back to a
    // real global would throw here rather than quietly work.
    expect(typeof globalThis.document).toBe('undefined')
    expect(typeof globalThis.window).toBe('undefined')

    const { controller, document } = setup()
    await controller.enter()
    await controller.enter('fullscreen')
    await controller.exit()
    controller.destroy()

    expect(document.listenerCount()).toBe(0)
    expect(typeof globalThis.document).toBe('undefined')
  })
})
