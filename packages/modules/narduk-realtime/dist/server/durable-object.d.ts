import { DurableObject } from 'cloudflare:workers';
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
export declare class HibernatingDurableObject<Env = unknown> extends DurableObject<Env> {
    constructor(ctx: DurableObjectState, env: Env);
    /**
     * Accept a server-side socket in hibernatable mode under the given tags.
     *
     * Tags are how a session is addressed later: `socketsWithTag`, `broadcast`
     * and `sessionCounts` all read them back from the runtime, so no session list
     * has to be held in memory across a hibernation.
     */
    protected acceptTagged(ws: WebSocket, tags: readonly string[]): void;
    /** Every currently attached socket carrying `tag`. */
    protected socketsWithTag(tag: string): WebSocket[];
    /**
     * Send `message` to every socket carrying `tag`.
     *
     * A socket that has already gone away throws on `send`; that is treated as a
     * closed session rather than a fan-out failure, so one dead peer never
     * silences the rest. Returns the number of sockets that accepted the message.
     */
    protected broadcast(tag: string, message: string | ArrayBuffer): number;
    /** Attached-socket count per tag, in the order the tags were given. */
    protected sessionCounts(tags: readonly string[]): Record<string, number>;
    /**
     * Complete the closing handshake.
     *
     * Without an explicit `webSocketClose`, a hibernatable socket is left
     * half-closed until the runtime times it out, which keeps it in
     * `getWebSockets()` and skews every session count. Subclasses that override
     * this should still call `super.webSocketClose(...)`.
     */
    webSocketClose(ws: WebSocket, code: number, reason: string, wasClean: boolean): void;
}
/**
 * Re-exported so a Durable Object reads the router-set principal from the same
 * module it already imports -- `./worker/principal` carries no
 * `cloudflare:workers` import, so a route may import it too.
 */
export { NARDUK_ROUTER_HEADER_PREFIX, PRINCIPAL_HEADER, principalFromRequest, } from '../worker/principal.js';
export type { PrincipalCarrier } from '../worker/principal.js';
//# sourceMappingURL=durable-object.d.ts.map