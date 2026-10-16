/**
 * A browser (or any runtime with a `WebSocket`) client for a socket served by
 * {@link HibernatingDurableObject}: connect, keep alive, reconnect, and hand
 * every frame to the caller. Framework-free on purpose: a Vue or React app
 * wraps it in its own few-line composable.
 *
 * ## Cost rule
 *
 * The keepalive is the exact text `ping`, which the base class's
 * auto-response answers with `pong` while the object hibernates, so an idle
 * client never wakes the object. Any other keepalive text would wake it every
 * interval. The client sends nothing else.
 *
 * ## Delivery rule
 *
 * A push socket is a hint, never the record. Frames sent while the client was
 * disconnected are gone, so the caller must re-read its data when the socket
 * opens (`onState('open')`) and keep a slow fallback poll; this client only
 * reports state and frames.
 */
/** The `WebSocket` surface the client uses: the browser's, Node's and the Workers runtime's all satisfy it. */
export interface LiveSocketLike {
    addEventListener(type: 'close' | 'error' | 'open', listener: () => void): void;
    addEventListener(type: 'message', listener: (event: {
        data: unknown;
    }) => void): void;
    close(code?: number, reason?: string): void;
    readonly readyState: number;
    send(data: string): void;
}
export type LiveSocketConstructor = new (url: string) => LiveSocketLike;
/** `connecting` while a handshake is in flight, `open` once it completed, `closed` while waiting to retry, `stopped` after `stop()`. */
export type LiveSocketState = 'closed' | 'connecting' | 'open' | 'stopped';
export interface LiveSocketOptions {
    /** The `ws:` or `wss:` URL, or a function returning it (read on every connect). */
    url: string | (() => string);
    /** Every frame that parsed as JSON, other than the `pong` keepalive answer. */
    onFrame: (frame: unknown) => void;
    /** Every state change, including the first `connecting`. */
    onState?: (state: LiveSocketState) => void;
    /** Keepalive interval. Default 30 s. */
    pingMs?: number;
    /** A socket that has heard nothing (not even `pong`) for this long is treated as dead and replaced. Default 2.5 x `pingMs`. */
    deadMs?: number;
    /** First retry delay; doubles per consecutive failure. Default 1 s. */
    minBackoffMs?: number;
    /** Retry delay ceiling. Default 60 s. */
    maxBackoffMs?: number;
    /** Defaults to `globalThis.WebSocket`. */
    WebSocket?: LiveSocketConstructor;
    /** Jitter source in [0, 1). Defaults to `Math.random`. */
    random?: () => number;
    /** Clock in ms. Defaults to `Date.now`. */
    now?: () => number;
}
export interface LiveSocket {
    /** Connect (no-op while connecting or open). Starting again after `stop()` is allowed. */
    start(): void;
    /** Close the socket and cancel every timer; no reconnect follows. */
    stop(): void;
    /** The current state. */
    state(): LiveSocketState;
}
/** The keepalive pair the base class installs. */
export declare const LIVE_SOCKET_PING = "ping";
export declare const LIVE_SOCKET_PONG = "pong";
/** The delay before retry number `failures` (1-based): min x 2^(failures-1), capped, with +-20 % jitter. */
export declare function liveSocketBackoff(failures: number, minMs: number, maxMs: number, random?: () => number): number;
export declare function createLiveSocket(options: LiveSocketOptions): LiveSocket;
//# sourceMappingURL=live-socket.d.ts.map