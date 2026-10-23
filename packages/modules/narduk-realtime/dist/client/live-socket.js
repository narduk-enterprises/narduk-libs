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
/** The keepalive pair the base class installs. */
export const LIVE_SOCKET_PING = 'ping';
export const LIVE_SOCKET_PONG = 'pong';
const OPEN = 1;
/** The delay before retry number `failures` (1-based): min x 2^(failures-1), capped, with +-20 % jitter. */
export function liveSocketBackoff(failures, minMs, maxMs, random = Math.random) {
    const base = Math.min(minMs * 2 ** Math.max(0, failures - 1), maxMs);
    return Math.round(base * (0.8 + 0.4 * random()));
}
export function createLiveSocket(options) {
    const pingMs = options.pingMs ?? 30_000;
    const deadMs = options.deadMs ?? Math.round(pingMs * 2.5);
    const minBackoffMs = options.minBackoffMs ?? 1000;
    const maxBackoffMs = options.maxBackoffMs ?? 60_000;
    const connectTimeoutMs = options.connectTimeoutMs ?? 15_000;
    const random = options.random ?? Math.random;
    const now = options.now ?? Date.now;
    const Impl = options.WebSocket ?? globalThis.WebSocket;
    let current = 'stopped';
    let socket = null;
    let failures = 0;
    let lastHeard = 0;
    let pingTimer = null;
    let retryTimer = null;
    function setState(next) {
        if (next === current)
            return;
        current = next;
        try {
            options.onState?.(next);
        }
        catch {
            // A throwing callback must not leave the client without its timers.
        }
    }
    function clearTimers() {
        if (pingTimer !== null)
            clearInterval(pingTimer);
        if (retryTimer !== null)
            clearTimeout(retryTimer);
        pingTimer = null;
        retryTimer = null;
    }
    /** The socket is gone (closed, errored or found dead): drop it and schedule the next attempt. */
    function lost(target) {
        // A replaced socket's late events land here too; only the current one counts.
        if (target !== socket)
            return;
        socket = null;
        clearTimers();
        if (current === 'stopped')
            return;
        try {
            target.close();
        }
        catch {
            // Already closed.
        }
        failures += 1;
        setState('closed');
        // onState('closed') may have stopped (or stopped and restarted) the client:
        // then it owns the timers and the socket, and this attempt must not touch them.
        if (current !== 'closed' || socket !== null || retryTimer !== null)
            return;
        retryTimer = setTimeout(connect, liveSocketBackoff(failures, minBackoffMs, maxBackoffMs, random));
    }
    function connect() {
        retryTimer = null;
        if (current === 'stopped' || socket)
            return;
        if (!Impl) {
            setState('closed');
            return;
        }
        setState('connecting');
        let target;
        try {
            target = new Impl(typeof options.url === 'function' ? options.url() : options.url);
        }
        catch {
            failures += 1;
            setState('closed');
            retryTimer = setTimeout(connect, liveSocketBackoff(failures, minBackoffMs, maxBackoffMs, random));
            return;
        }
        socket = target;
        // A handshake that never completes (a black-holed network) is abandoned rather than left `connecting`.
        retryTimer = setTimeout(() => lost(target), connectTimeoutMs);
        target.addEventListener('open', () => {
            if (target !== socket)
                return;
            if (retryTimer !== null)
                clearTimeout(retryTimer);
            retryTimer = null;
            lastHeard = now();
            setState('open');
            // onState('open') may have stopped the client: no timers for a closed socket.
            if (target !== socket || current !== 'open')
                return;
            if (pingTimer !== null)
                clearInterval(pingTimer);
            pingTimer = setInterval(() => {
                if (target !== socket)
                    return;
                if (now() - lastHeard > deadMs)
                    return lost(target);
                // The backoff resets only once a socket has stayed open a full ping interval: a server that accepts and then
                // closes at once must still be retried more and more slowly, never every second.
                failures = 0;
                try {
                    if (target.readyState === OPEN)
                        target.send(LIVE_SOCKET_PING);
                }
                catch {
                    lost(target);
                }
            }, pingMs);
        });
        target.addEventListener('message', (event) => {
            if (target !== socket)
                return;
            lastHeard = now();
            if (typeof event.data !== 'string' || event.data === LIVE_SOCKET_PONG)
                return;
            let frame;
            try {
                frame = JSON.parse(event.data);
            }
            catch {
                return;
            }
            options.onFrame(frame);
        });
        target.addEventListener('close', () => lost(target));
        target.addEventListener('error', () => lost(target));
    }
    return {
        start() {
            if (current !== 'stopped')
                return;
            current = 'closed';
            failures = 0;
            connect();
        },
        stop() {
            const target = socket;
            socket = null;
            clearTimers();
            setState('stopped');
            if (target) {
                try {
                    target.close(1000, 'stopped');
                }
                catch {
                    // Already closed.
                }
            }
        },
        state: () => current,
    };
}
//# sourceMappingURL=live-socket.js.map