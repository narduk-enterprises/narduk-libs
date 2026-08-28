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
/** `'viewport'` is a fixed overlay; `'fullscreen'` is the Fullscreen API. */
export type MapKitFullscreenMode = 'fullscreen' | 'viewport';
/** Why `'fullscreen'` produced viewport mode instead. */
export type MapKitFullscreenFallbackCause = 
/** The request was made and the browser or the user refused it. */
'rejected'
/** Neither `requestFullscreen` nor `webkitRequestFullscreen` exists. */
 | 'unsupported';
/**
 * - `enter` / `exit`: the consumer called the controller.
 * - `escape`: the user pressed Escape while viewport mode was active.
 * - `external-exit`: native fullscreen ended outside the controller, e.g. the
 *   browser's own Escape handling or its fullscreen chrome.
 * - `fallback`: `'fullscreen'` was requested and viewport mode was delivered.
 * - `destroy`: `destroy()` tore an active session down.
 */
export type MapKitFullscreenReason = 'destroy' | 'enter' | 'escape' | 'exit' | 'external-exit' | 'fallback';
/** What the controller is presenting right now. */
export interface MapKitFullscreenState {
    readonly active: boolean;
    /** `null` when inactive. */
    readonly mode: MapKitFullscreenMode | null;
}
export interface MapKitFullscreenChangeEvent extends MapKitFullscreenState {
    /** `true` when `'fullscreen'` was asked for and viewport mode was delivered. */
    readonly fallback: boolean;
    /** Why the fallback happened; `null` when there was none. */
    readonly fallbackCause: MapKitFullscreenFallbackCause | null;
    readonly reason: MapKitFullscreenReason;
    /** The mode the consumer asked for; differs from `mode` only on a fallback. */
    readonly requestedMode: MapKitFullscreenMode | null;
}
export type MapKitFullscreenListener = (event: MapKitFullscreenChangeEvent) => void;
/**
 * The structural subset of the presented element.
 *
 * The fullscreen request signatures are `any`/`unknown` on purpose: the real
 * `requestFullscreen` takes a `FullscreenOptions` and returns a `Promise`, the
 * prefixed WebKit one takes nothing and returns nothing, and only these loose
 * shapes keep a real `HTMLElement` and a plain test double both assignable.
 */
export interface MapKitFullscreenElement {
    removeAttribute: (name: string) => void;
    requestFullscreen?: (options?: any) => unknown;
    setAttribute: (name: string, value: string) => void;
    style: {
        cssText: string;
    };
    webkitRequestFullscreen?: () => unknown;
}
/** The structural subset of a scroll container the scroll lock rewrites. */
export interface MapKitFullscreenScrollElement {
    style: {
        overflow: string;
    };
}
/** The structural subset of a `KeyboardEvent` the Escape handler reads. */
export interface MapKitFullscreenKeyboardEventLike {
    readonly key?: string;
}
/**
 * The structural subset of a `Document` the controller listens to and mutates.
 *
 * The listener parameter is `any` for the same reason it is in the pointer
 * probe: `lib.dom`'s `addEventListener` takes an
 * `EventListenerOrEventListenerObject`, and only `any` stays assignable in both
 * directions so that passing a real `document` still typechecks.
 */
export interface MapKitFullscreenDocument {
    addEventListener: (type: string, listener: (event: any) => void, options?: any) => void;
    body?: MapKitFullscreenScrollElement | null;
    documentElement?: MapKitFullscreenScrollElement | null;
    exitFullscreen?: () => unknown;
    fullscreenElement?: unknown;
    removeEventListener: (type: string, listener: (event: any) => void, options?: any) => void;
    webkitExitFullscreen?: () => unknown;
    webkitFullscreenElement?: unknown;
}
/** The structural subset of a `Window`; only used to resolve a document. */
export interface MapKitFullscreenWindow {
    document?: MapKitFullscreenDocument;
}
export interface MapKitFullscreenControllerOptions {
    /**
     * Mode used by `enter()` and `toggle()` when called without one. Default
     * `'viewport'`, which is the mode that works everywhere.
     */
    defaultMode?: MapKitFullscreenMode;
    /** Injectable document. Default: `window.document`, then `globalThis.document`. */
    document?: MapKitFullscreenDocument;
    /**
     * The element to present. It should be a wrapper with no `transform` /
     * `filter` / `backdrop-filter` / `perspective` / `contain: paint` ancestor --
     * see the containing-block caveat in the module doc comment.
     */
    element: MapKitFullscreenElement;
    /**
     * Exit viewport mode when the user presses Escape. Default `true`. Ignored in
     * native fullscreen, where the browser already owns Escape.
     */
    exitOnEscape?: boolean;
    /**
     * Hide document scrolling while viewport mode is active and restore the
     * previous inline values on exit. Default `true`.
     */
    lockScroll?: boolean;
    /**
     * Called after every geometry change -- entering, exiting, falling back, and
     * an external fullscreen change -- and before the subscribers, so a consumer
     * can settle layout first. This is where a MapKit consumer calls
     * `refreshMapKitMapLayout(map)`.
     *
     * It runs synchronously, which is enough for MapKit because reading the
     * element's size forces layout. A consumer whose renderer needs a painted
     * frame should defer inside this callback.
     */
    onLayout?: (event: MapKitFullscreenChangeEvent) => void;
    /** Injectable window. Only used to resolve `document`. */
    window?: MapKitFullscreenWindow;
    /** Stacking order of the viewport overlay. Default `9999`. */
    zIndex?: number;
}
/** Set on the element while it is presented, as a consumer styling hook. */
export declare const MAPKIT_FULLSCREEN_ATTRIBUTE = "data-mapkit-fullscreen";
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
export declare class MapKitFullscreenController {
    #private;
    constructor(options: MapKitFullscreenControllerOptions);
    get active(): boolean;
    get destroyed(): boolean;
    /** The presented mode, or `null` when nothing is presented. */
    get mode(): MapKitFullscreenMode | null;
    /** Whether `'fullscreen'` can be attempted at all on this element. */
    get supportsNativeFullscreen(): boolean;
    /**
     * Present the element. Resolves with the mode actually delivered, which is
     * `'viewport'` when a `'fullscreen'` request could not be honored.
     */
    enter(mode?: MapKitFullscreenMode): Promise<MapKitFullscreenState>;
    /**
     * Restore the element. A no-op when nothing is presented.
     *
     * The controller's own state is restored synchronously -- there is nothing to
     * await inside, and the returned promise exists only so `enter()`, `exit()`,
     * and `toggle()` share one awaitable surface. The browser's native fullscreen
     * teardown may complete a frame later.
     */
    exit(): Promise<MapKitFullscreenState>;
    /** Enter when inactive, exit when active. `mode` is ignored while active. */
    toggle(mode?: MapKitFullscreenMode): Promise<MapKitFullscreenState>;
    subscribe(listener: MapKitFullscreenListener): () => void;
    /**
     * Restore the element, detach every listener, and make the controller inert.
     * An active presentation emits one final `'destroy'` event before the
     * subscribers are dropped, so a consumer's own state can settle.
     */
    destroy(): void;
}
/** Create a {@link MapKitFullscreenController} for one element. */
export declare function createMapKitFullscreenController(options: MapKitFullscreenControllerOptions): MapKitFullscreenController;
//# sourceMappingURL=fullscreen.d.ts.map