import { expect } from '@playwright/test'

import type { Locator, Page } from '@playwright/test'

/**
 * A masked region, and the reason it had to be masked.
 *
 * A mask is a deliberate admission that part of the page cannot be made reproducible — a live map
 * canvas, a third-party embed, a video frame. That is sometimes true and sometimes a shortcut past
 * a defect, and the difference is invisible in a screenshot. Carrying the reason in the type means
 * a mask cannot be added without writing down why, and a reviewer reads the answer in the spec
 * instead of guessing from a grey rectangle.
 */
export interface DocumentedMask {
  locator: Locator
  /** Why this region cannot be stabilised. Written for the next person, not for the linter. */
  reason: string
}

export interface VisualQuiescenceOptions {
  /**
   * How long the page must go without a DOM mutation or a running animation before it counts as
   * at rest. Default 150ms — long enough to bridge a `requestAnimationFrame` render loop and a
   * short microtask chain, short enough not to dominate a suite.
   */
  quietMs?: number
  /**
   * Ceiling on the whole wait. Reaching it RESOLVES rather than throws: a screenshot of the page
   * that would not settle tells a reader more than a timeout error does. Default 5000ms.
   */
  timeoutMs?: number
  /** Skip the `networkidle` wait — for a page that holds a socket or a poll open. Default false. */
  skipNetworkIdle?: boolean
}

export interface FreezeClockOptions {
  /**
   * Also pin `performance.timeOrigin`-relative readings. Off by default and rarely wanted: the
   * point of this helper is to leave the performance timeline alone.
   */
  freezePerformanceNow?: boolean
}

export interface DeterministicPageOptions extends FreezeClockOptions {
  /** The instant the page should believe it is. Omit to leave the clock alone. */
  now?: Date | number | string
  /** Emulate `prefers-reduced-motion: reduce`. Default true. */
  reducedMotion?: boolean
}

export interface StableScreenshotOptions extends VisualQuiescenceOptions {
  /**
   * How many capture pairs to try before declaring the page unable to settle. Default 3.
   *
   * `waitForVisualQuiescence` returning does not guarantee nothing lands in the gap between the
   * two captures — it says the page went quiet for `quietMs`, not that it is finished forever —
   * and on a loaded CI runner something occasionally does. Re-settling and trying again separates
   * the two cases that matter: a page that needed one more moment, and a page that genuinely never
   * stops. Playwright's own `toHaveScreenshot` retries for the same reason.
   */
  attempts?: number
  /**
   * Capture the whole document rather than the viewport.
   *
   * This does NOT use Playwright's `fullPage`. See {@link captureStableScreenshot} for the
   * measurement behind that decision.
   */
  fullPage?: boolean
  /** Name used in the failure message. Defaults to `path`, then to `the page`. */
  label?: string
  /** Regions that cannot be stabilised, each with its reason. See {@link DocumentedMask}. */
  mask?: DocumentedMask[]
  /** Fill colour for masked regions, as CSS. Playwright's default is `#FF00FF`. */
  maskColor?: string
  /** Where to write the capture. Omit to get the bytes back without touching the disk. */
  path?: string
  /** Skip the quiescence wait, for a caller that has already done its own. Default false. */
  skipQuiescence?: boolean
}

export interface RepeatableCaptureOptions {
  /** How many times to run the capture. Minimum 2, default 2. */
  attempts?: number
  /** Name used in the failure message. Default `the capture`. */
  label?: string
}

/** Chromium's texture ceiling. A viewport taller than this silently truncates the capture. */
const MAX_VIEWPORT_HEIGHT = 16_384

/** Byte equality without assuming Node's `Buffer` is in the consumer's type environment. */
function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false
  for (let index = 0; index < a.length; index += 1) if (a[index] !== b[index]) return false
  return true
}

function toEpochMs(instant: Date | number | string): number {
  const value = instant instanceof Date ? instant.getTime() : new Date(instant).getTime()
  if (!Number.isFinite(value)) {
    throw new Error(`freezePageClock() needs a real instant; received ${String(instant)}.`)
  }
  return value
}

/**
 * Pin `Date.now()` and `new Date()` to one instant, for the life of the page.
 *
 * Fixture data has fixed timestamps. A great deal of what an app RENDERS is not a timestamp but a
 * distance from one — `3 minutes ago`, `2 days old`, `expires in 4 h`, today's date in a header —
 * and every one of those moves with the wall clock while the fixture stays still. Screenshots
 * taken an hour apart then differ, and so do assertions written against the caption.
 *
 * NOT `page.clock`. Playwright's own clock is the obvious tool and it is the wrong one whenever a
 * suite also measures requests. `page.clock.setFixedTime()` freezes the date correctly and, as a
 * side effect, REPLACES `window.performance` with a plain object stub: measured on
 * `playwright@1.61.1`, `Object.getPrototypeOf(performance).constructor.name` becomes `Object`
 * rather than `Performance`, `performance.getEntriesByType` stops being native code, and
 * `getEntries()`, `getEntriesByType('resource')` and `getEntriesByType('navigation')` all return
 * zero entries on a page that has just loaded a document, a stylesheet, a script and four API
 * responses. Nothing throws — the Resource Timing API simply reports that the page fetched
 * nothing, so anything built on it (this package's own `playwright/request-accounting`, any
 * performance budget, any Web Vitals check) silently starts passing for the wrong reason.
 *
 * So the two readers are replaced directly, through a `Proxy` installed before any page script
 * runs. `Date.now()` and `new Date()` answer the frozen instant; `Date.parse`, `Date.UTC`,
 * `Date.prototype`, `instanceof Date` and `new Date(value)` are untouched, as are `setTimeout`,
 * `setInterval`, `requestAnimationFrame` and `performance`. The application's own scheduling —
 * animations, polling, cache revalidation — behaves exactly as it does in a browser, which is the
 * other half of the point: a frozen page that never finishes booting is not a deterministic page.
 *
 * Call before the first navigation.
 */
export async function freezePageClock(
  page: Page,
  instant: Date | number | string,
  options: FreezeClockOptions = {},
): Promise<void> {
  await page.addInitScript(
    ({ fixedMs, freezePerformanceNow }: { fixedMs: number; freezePerformanceNow: boolean }) => {
      const RealDate = Date
      window.Date = new Proxy(RealDate, {
        apply: () => new RealDate(fixedMs).toString(),
        construct: (target, args) =>
          args.length === 0 ? new RealDate(fixedMs) : Reflect.construct(target, args),
        get: (target, property, receiver) =>
          property === 'now' ? () => fixedMs : Reflect.get(target, property, receiver),
      }) as DateConstructor

      if (freezePerformanceNow) {
        // Deliberately narrow: only `now()` is replaced, so `getEntriesByType` and the rest of the
        // performance timeline keep working. This is the opposite trade-off from `page.clock`.
        const frozen = performance.now()
        Object.defineProperty(performance, 'now', { configurable: true, value: () => frozen })
      }
    },
    { fixedMs: toEpochMs(instant), freezePerformanceNow: options.freezePerformanceNow === true },
  )
}

/**
 * Emulate `prefers-reduced-motion: reduce` on the page itself.
 *
 * A Playwright config's `use: { reducedMotion: 'reduce' }` is the obvious way to say this, and on
 * `playwright@1.61.1` it does not work: the value is resolved into the project — inside a test,
 * `test.info().project.use.reducedMotion` reads `'reduce'` — and then dropped on the way to the
 * context, so the page answers `matchMedia('(prefers-reduced-motion: reduce)').matches === false`
 * and `matchMedia('(prefers-reduced-motion: no-preference)').matches === true`. A
 * `test.use({ reducedMotion: 'reduce' })` block behaves the same. `browser.newContext({
 * reducedMotion: 'reduce' })` and this `page.emulateMedia` call both work.
 *
 * The failure is silent and it is not only about transition timing. An app that READS the query in
 * JavaScript — to decide whether to offer an autoplay control, to pick an animated or instant
 * transition, to size a control that only exists when motion is allowed — renders a different tree
 * under the declaration that never applied, and that tree can be a different SIZE. Keep the config
 * declaration for intent; apply this for effect.
 */
export async function emulateReducedMotion(page: Page): Promise<void> {
  await page.emulateMedia({ reducedMotion: 'reduce' })
}

/**
 * Freeze the clock and apply reduced motion in one call, from a fixture or a `beforeEach`.
 *
 * Both steps run before the first navigation, which is where they have to run: an init script
 * added after `goto` misses the boot, and the media emulation has to be in place before the app
 * reads the query.
 */
export async function prepareDeterministicPage(
  page: Page,
  options: DeterministicPageOptions = {},
): Promise<void> {
  if (options.now !== undefined) {
    await freezePageClock(page, options.now, {
      freezePerformanceNow: options.freezePerformanceNow,
    })
  }
  if (options.reducedMotion !== false) await emulateReducedMotion(page)
}

/**
 * Wait until the page has stopped changing shape.
 *
 * This is a different question from "has the app finished loading", which only the app can answer
 * and which its own specs should assert. This one is about pixels: a client that boots in several
 * async waves rewrites its DOM once per wave, and a capture taken between two of them photographs
 * a state the app passes through rather than one it rests in — which state depending on how busy
 * the machine was.
 *
 * Three observable signals, no fixed sleep:
 *
 *  1. `networkidle` — nothing is still being fetched.
 *  2. `document.fonts.ready` — no face is still resolving. A late webfont reflows text and is one
 *     of the most common reasons two captures of the same screen differ.
 *  3. A quiet window — no DOM mutation and no running animation for `quietMs` consecutive
 *     milliseconds, sampled across animation frames. This is the one that catches a late render,
 *     and it is why the wait adapts instead of guessing at a `waitForTimeout`.
 */
export async function waitForVisualQuiescence(
  page: Page,
  options: VisualQuiescenceOptions = {},
): Promise<void> {
  const quietMs = options.quietMs ?? 150
  const timeoutMs = options.timeoutMs ?? 5_000
  if (options.skipNetworkIdle !== true) await page.waitForLoadState('networkidle')
  await page.evaluate(
    async ({ quietMs, timeoutMs }: { quietMs: number; timeoutMs: number }) => {
      await document.fonts.ready
      const deadline = performance.now() + timeoutMs
      await new Promise<void>((resolve) => {
        let lastChange = performance.now()
        const observer = new MutationObserver(() => {
          lastChange = performance.now()
        })
        observer.observe(document.documentElement, {
          attributes: true,
          characterData: true,
          childList: true,
          subtree: true,
        })
        const tick = (): void => {
          const now = performance.now()
          if (document.getAnimations().some((animation) => animation.playState === 'running')) {
            lastChange = now
          }
          if (now - lastChange >= quietMs || now >= deadline) {
            observer.disconnect()
            resolve()
            return
          }
          requestAnimationFrame(tick)
        }
        requestAnimationFrame(tick)
      })
    },
    { quietMs, timeoutMs },
  )
}

/**
 * Screenshot a page that has stopped moving, in a way that produces the same bytes every time.
 *
 * Two things beyond {@link waitForVisualQuiescence} are needed for that, and both are corrections
 * to how Playwright is normally used.
 *
 * PLAYWRIGHT'S `fullPage` IS NOT REPEATABLE, so `fullPage: true` here does not use it. Six
 * consecutive `screenshot({ fullPage: true })` calls against a settled, unchanging page produce
 * hashes A B A B A B: on the case this was measured from, the same 23 pixels flipping by one
 * 8-bit step along one card's rounded border, with `scrollY` pinned at 0 and `devicePixelRatio`
 * at 1 throughout. It is Chromium's beyond-the-viewport capture path rasterising alternate calls
 * differently, not the application. One capture per page hides it; a retry, a failure screenshot
 * or a second capture flips the parity and a committed PNG moves for no reason at all. This helper
 * grows the viewport to the document height and takes an ordinary capture instead, which is one
 * paint: four consecutive captures that way were byte-identical. The viewport is restored
 * afterwards even if the capture throws.
 *
 * A welcome side effect: `position: fixed` chrome is photographed pinned where a reader sees it,
 * rather than stranded partway down a tall page the way a stitched capture leaves it.
 *
 * THE PAGE IS PHOTOGRAPHED TWICE and the two are required to be byte-identical. The first is
 * returned and written; the second exists only to prove the first was of a resting page. A
 * difference means something was still landing — and rather than failing on the spot, the pair is
 * re-settled and retried up to `attempts` times, because a quiet window is evidence rather than a
 * guarantee and a loaded CI runner will occasionally slip something into the gap. Only a page that
 * disagrees on every attempt fails, and it fails saying so.
 *
 * This is cheap — a screenshot costs single-digit milliseconds — and it is a different guarantee
 * from re-running the suite: this catches a page that is MOVING, re-running catches a page that
 * BOOTS differently twice. Use {@link expectRepeatableCapture} for the second one.
 */
export async function captureStableScreenshot(
  page: Page,
  options: StableScreenshotOptions = {},
): Promise<Uint8Array> {
  const label = options.label ?? options.path ?? 'the page'
  if (options.skipQuiescence !== true) await waitForVisualQuiescence(page, options)

  const viewport = page.viewportSize()
  const grown = options.fullPage === true && viewport !== null ? viewport : null
  if (grown) {
    const height = await page.evaluate(() =>
      Math.max(
        document.documentElement.scrollHeight,
        document.body?.scrollHeight ?? 0,
        innerHeight,
      ),
    )
    await page.setViewportSize({
      width: grown.width,
      height: Math.min(Math.max(height, grown.height), MAX_VIEWPORT_HEIGHT),
    })
    if (options.skipQuiescence !== true) await waitForVisualQuiescence(page, options)
  }

  const shot = {
    animations: 'disabled' as const,
    ...(options.mask ? { mask: options.mask.map((entry) => entry.locator) } : {}),
    ...(options.maskColor ? { maskColor: options.maskColor } : {}),
  }

  const attempts = Math.max(1, options.attempts ?? 3)

  try {
    let written = await page.screenshot({ ...shot, path: options.path })
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      const again = await page.screenshot(shot)
      if (sameBytes(again, written)) return written
      if (attempt === attempts) {
        expect(
          false,
          `${label} was still changing while it was being photographed: ${attempts} consecutive ` +
            'capture pairs disagreed, with a settle wait between each. Something on this screen ' +
            'never comes to rest',
        ).toBe(true)
      }
      await waitForVisualQuiescence(page, options)
      written = await page.screenshot({ ...shot, path: options.path })
    }
    return written
  } finally {
    if (grown) await page.setViewportSize(grown)
  }
}

/**
 * Run a capture more than once and require every run to produce the same bytes.
 *
 * The argument is a function rather than a page on purpose. Pass `() => page.screenshot(...)` and
 * this proves the page is at rest — which {@link captureStableScreenshot} already does for you.
 * Pass a closure that navigates and then captures, and it proves something much stronger and much
 * harder to get: that the app BOOTS to the same pixels twice. That is the property a committed
 * screenshot needs, and the one that quietly rots — a caption derived from the clock, an emulation
 * that was declared but never applied, a layout that depends on which async wave landed first.
 * Wiring one of these into a suite turns "the goldens keep churning" from something a person
 * notices in `git status` into a test that fails.
 *
 * Returns the bytes from the first attempt.
 */
export async function expectRepeatableCapture(
  capture: () => Promise<Uint8Array>,
  options: RepeatableCaptureOptions = {},
): Promise<Uint8Array> {
  const attempts = Math.max(2, options.attempts ?? 2)
  const label = options.label ?? 'the capture'
  const first = await capture()
  for (let attempt = 2; attempt <= attempts; attempt += 1) {
    const next = await capture()
    expect(
      sameBytes(next, first),
      `${label} is not reproducible: attempt ${attempt} of ${attempts} produced different bytes ` +
        'from the first. Something the capture depends on is not pinned — the clock, a media ' +
        'emulation, a font, an animation, or the order two async loads landed in',
    ).toBe(true)
  }
  return first
}
