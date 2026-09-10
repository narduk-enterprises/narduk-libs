/**
 * The header prefix the upgrade router owns.
 *
 * Every inbound header starting with this prefix is **stripped** from every
 * request the router sees -- the upgrade it authorises and forwards to a Durable
 * Object, and equally the ordinary requests it hands back to the Nitro app -- and
 * it is the only prefix the router itself writes. That is what makes a principal
 * header trustworthy inside the object: a client cannot set one, and neither can
 * an app route through `forwardHeaders` (the prefix is rejected at configuration
 * time).
 *
 * The guarantee covers requests that came *through* the router, which is every
 * request the Worker serves. It cannot cover a request an app route builds
 * itself: an h3 handler that calls `stub.fetch(new Request(url, { headers }))`
 * decides those headers, so the object still owns the check. And the trust is
 * about *origin* only -- validate the shape of what is read, always.
 */
export const NARDUK_ROUTER_HEADER_PREFIX = 'x-narduk-'

/** Header the router sets when an authoriser returns one under this name. */
export const PRINCIPAL_HEADER = 'x-narduk-principal'

/** The only part of a `Request` {@link principalFromRequest} needs. */
export interface PrincipalCarrier {
  headers: { get(name: string): string | null }
}

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
export function principalFromRequest<Principal = unknown>(
  request: PrincipalCarrier,
  header: string = PRINCIPAL_HEADER,
): Principal | undefined {
  const raw = request.headers.get(header)
  if (raw === null || raw.length === 0) return undefined

  try {
    return JSON.parse(raw) as Principal
  } catch {
    return undefined
  }
}
