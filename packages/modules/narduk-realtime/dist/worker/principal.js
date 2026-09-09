/**
 * The header prefix the upgrade router owns.
 *
 * Every inbound header starting with this prefix is **stripped** before the
 * router authorises an upgrade or forwards it to a Durable Object, and it is the
 * only prefix the router itself writes. That is what makes a principal header
 * trustworthy inside the object: a client cannot set one, and neither can an
 * app route through `forwardHeaders` (the prefix is rejected at configuration
 * time). The trust is about *origin* only -- the object must still validate the
 * shape of what it reads.
 */
export const NARDUK_ROUTER_HEADER_PREFIX = 'x-narduk-';
/** Header the router sets when an authoriser returns one under this name. */
export const PRINCIPAL_HEADER = 'x-narduk-principal';
/**
 * Read the principal the upgrade router attached to a forwarded request.
 *
 * Returns `undefined` when the header is absent or is not valid JSON, so a
 * Durable Object reached by any other path simply sees no principal rather than
 * an exception. Validate the parsed value before trusting its *contents*:
 *
 * ```ts
 * const principal = VesselPrincipalSchema.safeParse(principalFromRequest(request))
 * if (!principal.success) return new Response('forbidden', { status: 403 })
 * ```
 */
export function principalFromRequest(request, header = PRINCIPAL_HEADER) {
    const raw = request.headers.get(header);
    if (raw === null || raw.length === 0)
        return undefined;
    try {
        return JSON.parse(raw);
    }
    catch {
        return undefined;
    }
}
//# sourceMappingURL=principal.js.map