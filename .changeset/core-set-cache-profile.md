---
'@narduk-enterprises/narduk-core': minor
---

Add `setCacheProfile`: typed edge-cache profiles, so apps stop hand-writing
`Cache-Control` strings per route.

The strings were not merely repetitive, they were wrong. `buoys` has three of
them and all three pair `s-maxage` with `stale-while-revalidate`. `s-maxage`
_disables_ stale-serving — RFC 9111 §4.2.4, and Cloudflare's Workers Caching
docs state it outright: "If your response includes any of `s-maxage`,
`must-revalidate`, or `proxy-revalidate`, the stale-serving behavior is
disabled". The 900s, 1800s and 86400s stale windows those three strings
advertise do not exist. A hand-written header string has nothing to catch that;
a typed profile does.

`setCacheProfile(event, 'live' | 'slow' | 'static' | 'none' | inline)` emits the
split pair Cloudflare documents for this case instead: the browser window on
`Cache-Control: max-age` and the longer edge window on
`CDN-Cache-Control: max-age`, with `stale-while-revalidate` intact on both.
`CDN-Cache-Control` is the middle rung of Cloudflare's precedence
(`cloudflare-cdn-cache-control` > `cdn-cache-control` > `Cache-Control`) and is
respected by Cloudflare _and_ passed downstream, so the edge TTL stays visible
while debugging. Nothing in the library ever emits `s-maxage`, and a test
asserts that across every profile.

The three named profiles carry Buoys' existing numbers, so a migrating app's
browser TTLs are byte-identical before and after; only the edge behavior is
repaired. `runtimeConfig.cache.profiles` overrides the seconds of any profile
per app, ignoring negative, fractional and non-numeric values.

An optional `tags` array emits `Cache-Tag` for purge-by-tag, validated against
Cloudflare's contract — printable ASCII, no spaces or commas, 1024 characters
per tag, 1000 tags per response, case-insensitive dedupe to match
case-insensitive purge matching. Invalid tags are dropped rather than throwing,
which is what the platform does at storage time. Purge by tag is available on
every plan (Enterprise-only until 2025-04-01), so no purge-everything fallback
is needed.

`vary` merges with any `Vary` another handler already set, deduplicating
case-insensitively while preserving the first spelling.

`setCacheProfile` refuses to emit a cacheable posture — falling back to
`private, no-store` with no `Cache-Tag` — when the response status is >= 400,
when a `Set-Cookie` is already present, when `Vary: *` (which Cloudflare treats
as uncacheable regardless), or in `previewSafeMode`. None of those are
configurable, and the returned result names which guard fired.

One caveat worth reading the README section for: Workers run _before_ the cache,
so none of these edge headers bind until an app opts into Workers Cache with
`"cache": { "enabled": true }` in its Wrangler config (Wrangler >= 4.69.0).
Until then the browser `Cache-Control` is still correct and the edge headers are
inert. Workers Cache also partitions by Worker version by default, so a
deployment already starts from a cold cache — a release is visible immediately
with nothing to purge.
