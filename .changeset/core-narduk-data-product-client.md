---
'@narduk-enterprises/narduk-core': minor
---

Add `createNardukDataClient` and `fetchNardukDataJson` — a shared server-side
client for published narduk-data products, so an app that reads `data.nard.uk`
stops re-deriving the manifest/artifact/checksum dance and the resilience policy
around it.

**The gap.** Buoys' `apps/web/server/utils/buoy-status-product.ts` hardcodes
`https://data.nard.uk`, fetches `current/manifest.json`, fetches the release
artifact, reads it under a byte ceiling, compares its SHA-256 against the
manifest, memoises the result for 60 seconds and coalesces concurrent misses —
about 120 lines before a single buoy-specific line. RiverStatus'
`apps/web/server/utils/narduk-river-data.ts` does the same walk again for
`river-status-v1`, with a different manifest validator, no timeout, no retry, no
memo and no coalescing. Neither has a retry, a stale-if-error fallback, or
freshness metadata a caller can act on, and the next consumer would have written
a third copy.

**The client.**

```ts
import { createNardukDataClient } from '@narduk-enterprises/narduk-core/server/utils/narduk-data'

const client = createNardukDataClient({ userAgent: 'BuoyStat.us/1.17' })

const { data, freshness, manifest } = await client.read(
  {
    artifactPath: 'public-buoy-data.json',
    freshness: { agingAfterMs: 45 * 60_000, staleAfterMs: 6 * 60 * 60_000 },
    maxStaleMs: 10 * 60_000,
    productId: 'buoy-status-v1',
    schema: productSchema,
  },
  { requestId: event.context._requestId },
)
```

`read` fetches the manifest, fetches the artifact the manifest names, refuses it
unless its SHA-256 matches, and validates both against caller-supplied schemas.
Each attempt carries its own `AbortSignal.timeout`; the bounded retry applies
only to an idempotent `GET`/`HEAD` and only on a network failure, a timeout or
an HTTP 5xx, so a 4xx, a schema failure and a checksum mismatch are never
repeated and a non-GET is attempted exactly once. Concurrent readers of the same
product join the read already in flight. `maxStaleMs` opts into serving the last
good value after an upstream failure; it defaults to 0, so the client fails
closed exactly as today's hand-rolled reads do.

**Freshness that stays honest.** Every result carries `fetchedAt`, `ageMs`,
`stale`, `source` (`upstream` | `memo` | `stale-if-error`), `releaseId`,
`publishedAt`, `publishedAgeMs`, the producer's own `publishedState` republished
verbatim, and a `state` of `fresh` | `aging` | `stale` | `unknown` derived from
the product's own thresholds. A manifest that states no publish time, and a
product that declares no thresholds, both yield `unknown` — never `fresh`. A
value served from the stale path says so rather than arriving as if it were
current, and an artifact that is validly empty stays distinguishable from a
missing or stale one.

**Errors, not silence.** Every failure is a `NardukDataError` carrying `reason`
(`aborted` | `checksum` | `http` | `network` | `schema` | `timeout` |
`too-large`), `status` and `url`, so a caller can tell an outage from a contract
break from its own cancellation.

**Worker-safe by construction.** No Node-only API, no module-level cache — the
caller owns the client instance and its cache is bounded by `maxEntries`
(default 8, least recently used evicted) — a hard body ceiling enforced against
bytes actually accumulated rather than a `content-length` the upstream declares,
and no timer of its own: cancellation rides on `AbortSignal`.

**Request-id ready.** `context.requestId` is sent as `x-request-id` and
`context.headers` is merged in, so the request-id middleware plugs in without
this module minting ids. Single-flight means the callers joined onto a read are
answered by a request carrying the first caller's id; the README says so.

**Placement.** `narduk-core` rather than a new package: it is already every
app's dependency, the consumers are Nitro server routes that install this layer
anyway, the freshness vocabulary it echoes lives here, and a new published
package would be a second release surface for one module. Additive only —
existing exports are untouched, and an app that never imports it gets an
identical build.

**Compatibility.** `schema` and `manifestSchema` accept any validator with a
zod-shaped `safeParse`, so zod v4 schemas plug in structurally and this package
takes on no validator dependency or version pin of its own.
