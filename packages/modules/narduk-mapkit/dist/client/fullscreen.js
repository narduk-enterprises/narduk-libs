/**
 * Fullscreen presentation for a map surface, in two modes.
 *
 * `'viewport'` is the standard mode and the default everywhere a default
 * exists: the element becomes a fixed-position overlay filling the browser
 * viewport. It works in every engine, keeps the page's own JavaScript, focus,
 * and scroll behavior intact, and can be styled by the consumer.
 *
 * `'fullscreen'` is the real Fullscreen API, for consumers who want the OS
 * chrome to disappear. It is not universally available -- iPhone Safari has no
 * element fullscreen at all -- so an unsupported or rejected request falls back
 * to viewport mode rather than failing. The change event says so: `fallback` is
 * `true`, `requestedMode` stays `'fullscreen'`, and `mode` reports what the
 * consumer actually got.
 *
 * ## The containing-block caveat
 *
 * Viewport mode positions the element with `position: fixed`, which is resolved
 * against the viewport **only while no ancestor establishes a containing block
 * for fixed descendants**. An ancestor with `transform`, `filter`,
 * `backdrop-filter`, `perspective`, `contain: paint` (or `will-change` naming
 * any of them) becomes that containing block, and the "fullscreen" element is
 * then trapped inside the ancestor's box -- usually as a slightly larger map
 * that is still inside the card it started in.
 *
 * This controller deliberately does **not** reparent the element to `<body>` to
 * dodge that: moving a live MapKit JS canvas in the DOM tears down its WebGL
 * context and loses map state. The fix belongs to the consumer -- apply the
 * controller to a wrapper that has no such ancestor. That wrapper is normally
 * the element holding the map *plus its own chrome*, so overlaid controls,
 * legends, and readouts come along into fullscreen instead of being left
 * behind on the page.
 *
 * Nothing here touches a DOM global at import time, and the element, document,
 * and window surfaces are declared structurally, so the state machine can be
 * exercised in Node with plain objects.
 *
 * @example
 * ```ts
 * const fullscreen = createMapKitFullscreenController({
 *   element: mapWrapper,
 *   onLayout: () => refreshMapKitMapLayout(map),
 * })
 *
 * button.addEventListener('click', () => void fullscreen.toggle())
 * ```
 */
const DEFAULT_VIEWPORT_Z_INDEX = 9999;
/** Set on the element while it is presented, as a consumer styling hook. */
export const MAPKIT_FULLSCREEN_ATTRIBUTE = 'data-mapkit-fullscreen';
/**
 * Geometry for a presented element.
 *
 * Both modes get the fill declarations: the UA's `:fullscreen` rule loses to
 * the element's own inline `width`/`height`, so a map sized inline would
 * otherwise stay small inside a black native-fullscreen screen. Only viewport
 * mode adds the fixed positioning and the stacking order. `top`/`right`/
 * `bottom`/`left` are written as longhands rather than `inset` so the string
 * needs no support check.
 */
function overlayCss(mode, zIndex) {
    const fill = 'width: 100%; height: 100%; max-width: none; max-height: none; margin: 0;';
    if (mode === 'fullscreen')
        return fill;
    return `position: fixed; top: 0; right: 0; bottom: 0; left: 0; ${fill} z-index: ${zIndex};`;
}
/**
 * Append rather than replace, so the consumer's own inline styles survive the
 * presentation. Later declarations win at equal specificity, so the overlay
 * geometry still overrides an inline `position` or `width`.
 */
function appendCss(base, addition) {
    const trimmed = base.trim();
    if (trimmed === '')
        return addition;
    return trimmed.endsWith(';') ? `${trimmed} ${addition}` : `${trimmed}; ${addition}`;
}
function resolveDocument(options) {
    const resolved = options.document ?? options.window?.document ?? globalThis.document;
    if (!resolved) {
        throw new Error('A DOM document is required to present a MapKit map fullscreen');
    }
    return resolved;
}
/**
 * Two-mode fullscreen presentation for one element.
 *
 * Disabled by default in the sense that matters: it does nothing until a
 * consumer constructs it and calls `enter()` or `toggle()`.
 *
 * Mode semantics, which are easy to get wrong:
 *
 * - `enter()` with no argument uses `defaultMode`.
 * - `enter(mode)` while already presenting that same mode is a no-op and emits
 *   nothing.
 * - `enter(mode)` while presenting the *other* mode switches in place and emits
 *   exactly one event, not an exit followed by an enter.
 * - `enter('fullscreen')` while presenting viewport mode keeps viewport mode
 *   when the request is unsupported or rejected; the emitted event is the
 *   `'fallback'` one. A failed switch never leaves the consumer with nothing.
 * - `toggle(mode)` exits whenever anything is active, whatever `mode` says --
 *   a toggle is a toggle. Use `enter(mode)` to switch modes.
 */
export class MapKitFullscreenController {
    #defaultMode;
    #document;
    #element;
    #exitOnEscape;
    #listeners = new Set();
    #lockScroll;
    #onLayout;
    #zIndex;
    #destroyed = false;
    #escapeAttached = false;
    #mode = null;
    /** Identity of the in-flight native request, so a late rejection is ignored. */
    #nativeRequest = null;
    #savedBodyOverflow = null;
    #savedCssText = null;
    #savedRootOverflow = null;
    #onFullscreenChange = () => {
        if (this.#destroyed)
            return;
        if (this.#nativeElement() === this.#element) {
            // The change event lands before `requestFullscreen()` resolves, so this
            // is normally where a successful native enter is adopted.
            if (this.#mode === 'fullscreen')
                return;
            this.#nativeRequest = null;
            this.#teardown();
            this.#present('fullscreen');
            this.#settle('enter', 'fullscreen');
            return;
        }
        if (this.#mode !== 'fullscreen')
            return;
        this.#teardown();
        this.#settle('external-exit', null);
    };
    #onFullscreenError = () => {
        // Old WebKit reports a refused request here instead of rejecting a promise.
        if (this.#destroyed || this.#nativeRequest === null)
            return;
        this.#nativeRequest = null;
        this.#fallback('rejected');
    };
    #onKeyDown = (event) => {
        if (this.#mode !== 'viewport')
            return;
        if (event.key !== 'Escape' && event.key !== 'Esc')
            return;
        this.#teardown();
        this.#settle('escape', null);
    };
    constructor(options) {
        this.#defaultMode = options.defaultMode ?? 'viewport';
        this.#document = resolveDocument(options);
        this.#element = options.element;
        this.#exitOnEscape = options.exitOnEscape ?? true;
        this.#lockScroll = options.lockScroll ?? true;
        this.#onLayout = options.onLayout;
        this.#zIndex = options.zIndex ?? DEFAULT_VIEWPORT_Z_INDEX;
        this.#document.addEventListener('fullscreenchange', this.#onFullscreenChange);
        this.#document.addEventListener('webkitfullscreenchange', this.#onFullscreenChange);
        this.#document.addEventListener('fullscreenerror', this.#onFullscreenError);
        this.#document.addEventListener('webkitfullscreenerror', this.#onFullscreenError);
    }
    get active() {
        return this.#mode !== null;
    }
    get destroyed() {
        return this.#destroyed;
    }
    /** The presented mode, or `null` when nothing is presented. */
    get mode() {
        return this.#mode;
    }
    /** Whether `'fullscreen'` can be attempted at all on this element. */
    get supportsNativeFullscreen() {
        const element = this.#element;
        return (typeof element.requestFullscreen === 'function' ||
            typeof element.webkitRequestFullscreen === 'function');
    }
    /**
     * Present the element. Resolves with the mode actually delivered, which is
     * `'viewport'` when a `'fullscreen'` request could not be honored.
     */
    async enter(mode = this.#defaultMode) {
        if (this.#destroyed || this.#mode === mode)
            return this.#state();
        if (mode === 'fullscreen')
            return this.#enterNative();
        this.#teardown();
        this.#present('viewport');
        return this.#settle('enter', 'viewport');
    }
    /**
     * Restore the element. A no-op when nothing is presented.
     *
     * The controller's own state is restored synchronously -- there is nothing to
     * await inside, and the returned promise exists only so `enter()`, `exit()`,
     * and `toggle()` share one awaitable surface. The browser's native fullscreen
     * teardown may complete a frame later.
     */
    async exit() {
        if (this.#mode === null)
            return this.#state();
        this.#teardown();
        return this.#settle('exit', null);
    }
    /** Enter when inactive, exit when active. `mode` is ignored while active. */
    async toggle(mode = this.#defaultMode) {
        return this.#mode === null ? this.enter(mode) : this.exit();
    }
    subscribe(listener) {
        this.#listeners.add(listener);
        return () => {
            this.#listeners.delete(listener);
        };
    }
    /**
     * Restore the element, detach every listener, and make the controller inert.
     * An active presentation emits one final `'destroy'` event before the
     * subscribers are dropped, so a consumer's own state can settle.
     */
    destroy() {
        if (this.#destroyed)
            return;
        this.#destroyed = true;
        const wasActive = this.#mode !== null;
        // Abandons an in-flight native request, so it cannot present the element
        // after the consumer has torn the controller down.
        this.#nativeRequest = null;
        this.#teardown();
        this.#document.removeEventListener('fullscreenchange', this.#onFullscreenChange);
        this.#document.removeEventListener('webkitfullscreenchange', this.#onFullscreenChange);
        this.#document.removeEventListener('fullscreenerror', this.#onFullscreenError);
        this.#document.removeEventListener('webkitfullscreenerror', this.#onFullscreenError);
        if (wasActive)
            this.#settle('destroy', null);
        this.#listeners.clear();
    }
    async #enterNative() {
        const element = this.#element;
        const token = {};
        this.#nativeRequest = token;
        try {
            if (element.requestFullscreen) {
                await Promise.resolve(element.requestFullscreen());
            }
            else if (element.webkitRequestFullscreen) {
                await Promise.resolve(element.webkitRequestFullscreen());
            }
            else {
                this.#nativeRequest = null;
                return this.#fallback('unsupported');
            }
        }
        catch {
            if (this.#nativeRequest !== token)
                return this.#state();
            this.#nativeRequest = null;
            return this.#fallback('rejected');
        }
        // A `fullscreenerror`, or a `destroy()`, may already have resolved this
        // attempt while the request was in flight.
        if (this.#destroyed || this.#nativeRequest !== token)
            return this.#state();
        this.#nativeRequest = null;
        // A document that fires `fullscreenchange` has already adopted the session;
        // one that only resolves the promise is adopted here.
        if (this.#mode === 'fullscreen')
            return this.#state();
        this.#teardown();
        this.#present('fullscreen');
        return this.#settle('enter', 'fullscreen');
    }
    #fallback(cause) {
        this.#teardown();
        this.#present('viewport');
        return this.#settle('fallback', 'fullscreen', cause);
    }
    /** Apply the geometry, the styling hook, and the viewport-only side effects. */
    #present(mode) {
        const element = this.#element;
        const saved = element.style.cssText;
        this.#savedCssText = saved;
        element.style.cssText = appendCss(saved, overlayCss(mode, this.#zIndex));
        element.setAttribute(MAPKIT_FULLSCREEN_ATTRIBUTE, mode);
        this.#mode = mode;
        if (mode !== 'viewport')
            return;
        this.#lockDocumentScroll();
        this.#attachEscape();
    }
    /** Undo everything `#present()` did, without emitting. Safe when inactive. */
    #teardown() {
        const mode = this.#mode;
        if (mode === null)
            return;
        this.#mode = null;
        this.#detachEscape();
        this.#unlockDocumentScroll();
        if (this.#savedCssText !== null)
            this.#element.style.cssText = this.#savedCssText;
        this.#savedCssText = null;
        this.#element.removeAttribute(MAPKIT_FULLSCREEN_ATTRIBUTE);
        if (mode === 'fullscreen')
            this.#releaseNative();
    }
    #releaseNative() {
        // Only leave fullscreen when this element is the one holding it; the
        // document has already left it after an external exit.
        if (this.#nativeElement() !== this.#element)
            return;
        const owner = this.#document;
        try {
            // Equivalent to `() => {}`; this fold changes no runtime expression.
            // eslint-disable-next-line unicorn/no-useless-undefined -- narduk-libs#138
            if (owner.exitFullscreen)
                void Promise.resolve(owner.exitFullscreen()).catch(() => undefined);
            else
                owner.webkitExitFullscreen?.();
        }
        catch {
            // The document refused or had already left; the element is restored
            // either way, so there is nothing further to do.
        }
    }
    #nativeElement() {
        return this.#document.fullscreenElement ?? this.#document.webkitFullscreenElement ?? null;
    }
    #lockDocumentScroll() {
        if (!this.#lockScroll)
            return;
        // Both are locked: the root's used `overflow` propagates to the viewport,
        // and the body's only propagates when the root leaves it `visible`.
        const root = this.#document.documentElement;
        if (root) {
            this.#savedRootOverflow = root.style.overflow;
            root.style.overflow = 'hidden';
        }
        const body = this.#document.body;
        if (body) {
            this.#savedBodyOverflow = body.style.overflow;
            body.style.overflow = 'hidden';
        }
    }
    #unlockDocumentScroll() {
        const root = this.#document.documentElement;
        if (root && this.#savedRootOverflow !== null)
            root.style.overflow = this.#savedRootOverflow;
        this.#savedRootOverflow = null;
        const body = this.#document.body;
        if (body && this.#savedBodyOverflow !== null)
            body.style.overflow = this.#savedBodyOverflow;
        this.#savedBodyOverflow = null;
    }
    /** Attached only while viewport mode is active; a document-wide key handler
     *  should not sit on the page for a controller nobody has entered. */
    #attachEscape() {
        if (!this.#exitOnEscape || this.#escapeAttached)
            return;
        this.#escapeAttached = true;
        this.#document.addEventListener('keydown', this.#onKeyDown);
    }
    #detachEscape() {
        if (!this.#escapeAttached)
            return;
        this.#escapeAttached = false;
        this.#document.removeEventListener('keydown', this.#onKeyDown);
    }
    #state() {
        return { active: this.#mode !== null, mode: this.#mode };
    }
    #settle(reason, requestedMode, fallbackCause = null) {
        const event = {
            active: this.#mode !== null,
            fallback: fallbackCause !== null,
            fallbackCause,
            mode: this.#mode,
            reason,
            requestedMode,
        };
        this.#onLayout?.(event);
        for (const listener of [...this.#listeners])
            listener(event);
        return { active: event.active, mode: event.mode };
    }
}
/** Create a {@link MapKitFullscreenController} for one element. */
export function createMapKitFullscreenController(options) {
    return new MapKitFullscreenController(options);
}
//# sourceMappingURL=fullscreen.js.map