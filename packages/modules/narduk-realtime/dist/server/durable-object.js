import { DurableObject } from 'cloudflare:workers';
/**
 * WebSocket close codes a Worker is not allowed to send back to a peer.
 *
 * 1005 ("no status received") and 1006 ("abnormal closure") are reserved: they
 * are produced by the runtime, never transmitted, and `WebSocket#close()`
 * throws if either is passed. Echoing the peer's code without this guard turns
 * an ordinary dropped connection into a Durable Object exception.
 */
const RESERVED_CLOSE_CODES = new Set([1005, 1006]);
/** Close code used when the peer's own code cannot be echoed. */
const NORMAL_CLOSURE = 1000;
/**
 * Base class for a hibernating, WebSocket-fan-out Durable Object.
 *
 * ## Cost rule (company-hq paved-paths `web-cf` stack note, D-PAVED-1)
 *
 * A Durable Object built on this class **hibernates by default** and must never
 * sit on the per-message hot path for an idle tenant. Two properties carry that:
 *
 * - Hibernatable WebSockets. Sockets are accepted with
 *   {@link HibernatingDurableObject.acceptTagged | `acceptTagged`}, which uses
 *   `ctx.acceptWebSocket()` rather than `server.accept()`. The isolate is
 *   evicted while idle and the delivered message wakes it; an idle socket costs
 *   no duration.
 * - Runtime-answered pings. The constructor installs a
 *   `ping`/`pong` auto-response pair, so keepalive traffic is answered by the
 *   runtime while the object is hibernated and never wakes it at all.
 *
 * A *resident* (non-hibernating) Durable Object costs roughly **$4 per month**
 * each, charged for wall-clock duration whether or not anything is happening.
 * That is the number that makes per-tenant objects viable or not, so do not
 * introduce an alarm loop, a timer, or an always-open outbound connection that
 * keeps one of these resident. Steady-state aggregates belong in D1 or KV on a
 * batch path, not in a woken object.
 *
 * @example
 * ```ts
 * import { HibernatingDurableObject } from '@narduk-enterprises/narduk-realtime/server/durable-object'
 *
 * export class VesselDO extends HibernatingDurableObject {
 *   override async fetch(request: Request): Promise<Response> {
 *     if (request.headers.get('upgrade') === 'websocket') {
 *       const [client, server] = Object.values(new WebSocketPair())
 *       this.acceptTagged(server as WebSocket, ['viewer'])
 *       return new Response(null, { status: 101, webSocket: client as WebSocket })
 *     }
 *     return Response.json(this.sessionCounts(['viewer', 'edge']))
 *   }
 * }
 * ```
 */
export class HibernatingDurableObject extends DurableObject {
    constructor(ctx, env) {
        super(ctx, env);
        // Answered by the runtime while hibernated: a keepalive ping never wakes
        // the object, so an idle control socket costs zero duration.
        this.ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping', 'pong'));
    }
    /**
     * Accept a server-side socket in hibernatable mode under the given tags.
     *
     * Tags are how a session is addressed later: `socketsWithTag`, `broadcast`
     * and `sessionCounts` all read them back from the runtime, so no session list
     * has to be held in memory across a hibernation.
     */
    acceptTagged(ws, tags) {
        this.ctx.acceptWebSocket(ws, [...tags]);
    }
    /** Every currently attached socket carrying `tag`. */
    socketsWithTag(tag) {
        return this.ctx.getWebSockets(tag);
    }
    /**
     * Send `message` to every socket carrying `tag`.
     *
     * A socket that has already gone away throws on `send`; that is treated as a
     * closed session rather than a fan-out failure, so one dead peer never
     * silences the rest. Returns the number of sockets that accepted the message.
     */
    broadcast(tag, message) {
        let delivered = 0;
        for (const socket of this.ctx.getWebSockets(tag)) {
            try {
                socket.send(message);
                delivered += 1;
            }
            catch {
                // The peer is gone. The runtime will deliver webSocketClose/Error.
            }
        }
        return delivered;
    }
    /** Attached-socket count per tag, in the order the tags were given. */
    sessionCounts(tags) {
        return Object.fromEntries(tags.map((tag) => [tag, this.ctx.getWebSockets(tag).length]));
    }
    /**
     * Complete the closing handshake.
     *
     * Without an explicit `webSocketClose`, a hibernatable socket is left
     * half-closed until the runtime times it out, which keeps it in
     * `getWebSockets()` and skews every session count. Subclasses that override
     * this should still call `super.webSocketClose(...)`.
     */
    webSocketClose(ws, code, reason, wasClean) {
        const echoable = wasClean && !RESERVED_CLOSE_CODES.has(code);
        ws.close(echoable ? code : NORMAL_CLOSURE, reason);
    }
}
//# sourceMappingURL=durable-object.js.map