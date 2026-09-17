/**
 * MapKit JS v6 initialization through Apple's own `@apple/mapkit-loader`.
 *
 * The contract here is narduk-libs#421 §d, which is normative and corrects the
 * 2.0.x shape in three ways:
 *
 * 1. `load()` is called **without** `token`. A token there lands in
 *    `data-token` on the injected script and wires MapKit's static,
 *    non-refreshable path.
 * 2. `libraries` is mandatory in v6, so it is a required option here.
 * 3. MapKit never re-asks for a token after a failed exchange. Measured on
 *    2026-09-17: on a rejected token it retried `/ma/bootstrap` three times with
 *    the SAME token, invoked `authorizationCallback` exactly once, and gave up.
 *    So the `error` handler clears the singleton, and recovery belongs to the
 *    caller (`<AppMapKit>`'s `retry()`).
 */
import type { MapKit } from '@apple/mapkit-loader';
/**
 * A MapKit JS v6 library name -- `'map'`, `'annotations'`, `'overlays'`, and
 * whatever else Apple ships. Apple types `mapkit.Libraries` as `string[]` and
 * publishes no union, so this deliberately does not invent one.
 */
export type MapKitLibrary = string;
/**
 * Apple's `ConfigurationErrorStatus`, verbatim (§c.7). Apple's own `.d.ts` does
 * not export the type, so it is restated here and pinned to
 * `MapKitConfigurationErrorEvent['status']` by a compile-time conformance check
 * in `tests/loader.test.ts`.
 */
export type MapKitErrorStatus = 'Bad Request' | 'Malformed Response' | 'Network Error' | 'Timeout' | 'Too Many Requests' | 'Unauthorized' | 'Unknown';
/** Apple's `ConfigurationChangeStatus`, verbatim. */
export type MapKitConfigurationChangeStatus = 'Initialized' | 'Refreshed';
export interface MapKitFailure {
    /** Present for `source: 'token'`. */
    httpStatus?: number;
    message: string;
    /** Parsed from Apple's `Origin does not match - expected: X, actual: Y` suffix. */
    originMismatch?: {
        actual: string;
        expected: string;
    };
    source: 'mapkit' | 'token';
    status: MapKitErrorStatus;
}
/** Thrown by `initializeMapKit()`; carries the `MapKitFailure` §c.7 renders. */
export declare class MapKitAuthError extends Error implements MapKitFailure {
    readonly httpStatus?: number;
    readonly originMismatch?: {
        actual: string;
        expected: string;
    };
    readonly source: 'mapkit' | 'token';
    readonly status: MapKitErrorStatus;
    constructor(failure: MapKitFailure);
    /** The plain `MapKitFailure` a caller renders through `#error`. */
    get failure(): MapKitFailure;
}
/** The body the token route returns on success (§e.2). */
export interface MapKitTokenEndpointResponse {
    error?: string;
    expiresAt?: number;
    token?: string;
}
/** `@apple/mapkit-loader`'s `load`, narrowed to what this module passes it. */
export type MapKitLoadFunction = (options: {
    language?: string;
    libraries?: string[];
    nonce?: string;
    version?: string;
}) => Promise<MapKit>;
export interface MapKitClientOptions {
    /** Injected under test. Defaults to `globalThis.fetch`. */
    fetchImpl?: typeof fetch;
    language?: string;
    /** Mandatory in v6: `mapkit.core.js` is a stub without them. */
    libraries: readonly MapKitLibrary[];
    /** Injected under test. Defaults to `@apple/mapkit-loader`'s `load`. */
    loadImpl?: MapKitLoadFunction;
    /** CSP nonce for the injected `<script>`. */
    nonce?: string;
    /** Fires for `'Initialized'` and for every later `'Refreshed'`. */
    onConfigurationChange?: (status: MapKitConfigurationChangeStatus) => void;
    /** Fires for every MapKit `error`, including ones after a successful init. */
    onFailure?: (failure: MapKitFailure) => void;
    /** Relative path only; the fetch must stay same-origin. */
    tokenEndpoint?: string;
    /** Defaults to `'6'`. The loader throws on any `5*`. */
    version?: string;
}
/** Apple's diagnostic is the single most useful string for a bad preview host. */
export declare function parseMapKitOriginMismatch(message: string): {
    actual: string;
    expected: string;
} | undefined;
/** Token-route refusals map onto Apple's own names rather than a parallel enum (§c.7). */
export declare function mapKitErrorStatusForHttpStatus(httpStatus: number): MapKitErrorStatus;
/**
 * Fetch one token from the same-origin route.
 *
 * The endpoint is relative on purpose, so the request always goes to the origin
 * that served the page -- the origin Apple will enforce in the `origin` claim.
 * The token is never persisted, never logged, and never put in a URL.
 */
export declare function fetchMapKitToken(endpoint?: string, fetchImpl?: typeof fetch): Promise<string>;
/**
 * Load MapKit JS v6 and complete one token exchange.
 *
 * Singleton: four call sites share one initialization. A failure clears the
 * singleton so a caller can retry -- MapKit itself never will.
 */
export declare function initializeMapKit(options: MapKitClientOptions): Promise<MapKit>;
export declare function resetMapKitClientStateForTests(): void;
//# sourceMappingURL=mapkit.d.ts.map