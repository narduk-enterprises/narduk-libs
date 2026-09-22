# Turning on Workers Cache in an existing app

This is the narduk-app standard for making `setCacheProfile` bind at the edge
(narduk-libs#435). New apps from `create-narduk-app` 0.12.0 and later already
ship the switch. An existing app turns it on by hand, one app at a time,
following this page. `narduk-app upgrade` does not do it:
`apps/web/wrangler.jsonc` is app-owned, and a cache switch is a decision about
that app's routes, not a template fix.

The mechanism is Cloudflare's
[Workers Cache](https://developers.cloudflare.com/workers/cache/configuration/),
a Worker-owned switch in the Wrangler config. The configuration and
[purge](https://developers.cloudflare.com/workers/cache/purge/) pages were
re-read on 2026-09-22; they were last updated 2026-07-06 and 2026-08-20. A zone
Cache Rule is not used: the Worker-owned switch is versioned with the code and
needs no dashboard state.

## What changes when it is on

Without the switch, a response a Worker generates is never stored. The
`CDN-Cache-Control` and `Cache-Tag` headers that `setCacheProfile` writes are
inert. With it on, Cloudflare checks the cache **before** it invokes the Worker,
and stores what the Worker returns according to its headers:

- `private` and `no-store` are not stored.
- `no-cache` **is** stored, then revalidated. This is why Nitro's default error
  headers were a problem (narduk-libs#429, #493).
- A response with no `Cache-Control` and no `Expires` is stored by RFC 9111
  heuristic freshness: a 200 for 2 hours, a 404 for 3 minutes.
- The cache bypasses itself for a response with `Set-Cookie`, and for a request
  with `Authorization` unless the response says `public`, `must-revalidate` or
  `s-maxage`.

A stored response is served to every visitor. The failure mode is one visitor's
data, error or CSP nonce replayed to others.

## Preconditions

All of these hold before the switch goes on.

1. **narduk-core 2.10.0 or later.** Foundation check 12.7
   (`narduk-app foundation:check:deployment`) fails an older core with the
   switch on, even in rollout mode. What each release added:

   | narduk-core | Keeps out of the cache                                                            |
   | ----------- | --------------------------------------------------------------------------------- |
   | 2.2.3       | thrown 4xx/5xx/429 rendered as HTML (`error-cache`, #429)                         |
   | 2.2.4       | SSR HTML under a nonce CSP (`nonce-csp-cache`, #435)                              |
   | 2.5.0       | any response that leaves with no posture (`default-private-cache`)                |
   | 2.10.0      | thrown errors answered as JSON: `/api/*`, `Accept: application/json`, curl (#493) |

   Before 2.10.0 a thrown API 404 left with Nitro's `no-cache` and was stored.

2. **Per-request headers are stripped.** Core strips rate-limit quota and
   correlation ids from any shared-cacheable response (#412, #418). That code
   runs today and does nothing visible. It becomes load-bearing the day the
   switch goes on, so check that the app does not re-add such a header after
   `setCacheProfile` in its own middleware.

3. **Every route of the app's own has a posture.** Core covers the defaults
   above. What it cannot cover is a route that writes its own headers without
   `Cache-Control`, such as a returned `Response`, a `sendStream`, or a
   server-route proxy. List the app's `server/api` and `server/routes` handlers.
   Each one either calls `setCacheProfile`, sets `Cache-Control` itself, or is
   left to `default-private-cache`. Anything per-user uses
   `setCacheProfile(event, 'none')`.

4. **Nonce-CSP apps cache JSON only.** With `nardukCore.security.headers` on,
   SSR HTML is always `private, no-store`, and `setCacheProfile` refuses it
   (`nonce-csp-html`). The benefit comes from JSON routes marked `live` or
   `slow`. Do not turn the CSP off to cache pages.

## The change

In `apps/web/wrangler.jsonc`, at the top level (Wrangler 4.69.0 or later):

```jsonc
{
  // Workers Cache: setCacheProfile's CDN-Cache-Control and Cache-Tag bind here.
  // Standard and rollback: narduk-app-tools docs/workers-cache.md (narduk-libs#435).
  "cache": { "enabled": true },
}
```

An `env.<name>` block inherits it and can override it. A preview or staging env
that must never cache sets `"cache": { "enabled": false }` in its own block.
Check 12.7 reads every scope, including TOML `[cache]` and `[env.<name>.cache]`.

Leave `cross_version_cache` off. With it off, the Worker version is part of the
cache key, so every deployment starts from a cold cache. A release is visible at
once, with nothing to purge.

Then run the repository check:

```bash
pnpm exec narduk-app foundation:check:deployment
```

12.7 must be `pass`. `fail` means the core is older than 2.10.0. `unknown` means
the core spec names no version, such as `workspace:*`.

## Proving it after the deploy

12.7 reads the repository. It cannot see whether the running Worker HITs. After
the production deploy:

```bash
pnpm exec narduk-app verify --live https://<production-host> --edge-cache-path /api/<live-route> --edge-uncached-path / --edge-uncached-path /api/does-not-exist
```

- `--edge-cache-path` makes two GETs and needs `Cf-Cache-Status: HIT` on the
  second.
- `--edge-uncached-path` needs no HIT. `/` covers the nonce-CSP page, and a
  missing API path covers #493.
- Either failure exits `7`.

Prove against the production hostname. A preview-safe hostname (`*.workers.dev`
or a version preview) forces every profile to `none`, so it never HITs.

## Purging

A deployment already starts cold, so a purge is only needed for data that
changed without a deploy. A profile given `tags` emits `Cache-Tag`. Purge inside
the Worker:

```ts
import { cache } from 'cloudflare:workers'

await cache.purge({ tags: ['stations'] })
```

`ctx.cache.purge(...)` is equivalent, and `pathPrefixes` and
`purgeEverything: true` also work. **A zone-level purge does not reach Workers
Cache.** That covers the dashboard, `/zones/{id}/purge_cache`, and Terraform.

## Rollback

Remove the `cache` block, or set `"enabled": false`, and deploy. The new version
is not cached, and the old version's entries are unreachable because the version
is part of the key. Nothing else in the app depends on the switch:
`setCacheProfile` goes back to setting only the browser `Cache-Control`.
