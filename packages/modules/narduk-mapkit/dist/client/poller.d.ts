import type { MapKitTimerScheduler } from './timers.js';
export interface MapKitPollerOptions<T> {
    intervalMs: number;
    /** Whether the page is on screen. Default: `document.hidden` is not `true`. */
    isVisible?: () => boolean;
    /** A request failed. The poll goes on at the normal interval. Default: ignored. */
    onError?: (error: unknown) => void;
    /** Receives each answer, unless the poller was restarted or stopped while it was in flight. */
    onResult: (result: T) => void;
    run: () => Promise<T>;
    timers?: MapKitTimerScheduler;
}
export interface MapKitPoller {
    /** Drop the in-flight answer and ask again now (the thing being polled changed). */
    restart: () => void;
    start: () => void;
    stop: () => void;
    /** Call when the document's visibility changes. */
    visibilityChanged: () => void;
}
export declare function createMapKitPoller<T>(options: MapKitPollerOptions<T>): MapKitPoller;
/** Run `fn` over `items` with at most `limit` in flight; results keep the input order. */
export declare function mapKitMapLimit<A, B>(items: readonly A[], limit: number, fn: (item: A, index: number) => Promise<B>): Promise<B[]>;
//# sourceMappingURL=poller.d.ts.map