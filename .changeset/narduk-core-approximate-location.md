---
'@narduk-enterprises/narduk-core': minor
---

Add `readApproximateLocation(event)`
(`@narduk-enterprises/narduk-core/server/utils/approximateLocation`),
narduk-libs#76 Wave 2's "Cloudflare approximate IP location helper".

Reads the visitor's approximate location from whichever Cloudflare signal the
runtime exposes — Nitro's `cloudflare_module` request-`cf` object (preferred;
always populated on a real Cloudflare deployment) or the `cf-ip*` request
headers a zone adds only when "Add visitor location headers" is enabled — and
returns the same `{ label, lat, lon, source: 'ip' }` shape either way, or `null`
when neither signal carries usable coordinates.

Extracted from riverstatus `server/api/v1/location/approximate.get.ts`
(`readCloudflareLocation`, request-`cf` reader) and borderwaitstat-us
`server/api/geo/ip.get.ts` (`cf-ip*` header reader); the borderwaitstat-us
version's Vercel-header fallback is app-specific migration cruft and was not
carried over. This is the library half only — an app's own
`server/api/.../*.get.ts` route still owns its URL path and response envelope
and now calls this helper instead of reading Cloudflare signals itself; consumer
migrations are tracked as follow-ups, not included in this change.
