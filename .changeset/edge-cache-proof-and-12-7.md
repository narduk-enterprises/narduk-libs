---
'@narduk-enterprises/narduk-app-tools': minor
---

Prove and gate Workers Cache (narduk-libs#435).

- `narduk-app verify --live` gains repeatable `--edge-cache-path <p>` and
  `--edge-uncached-path <p>`. Each route is fetched twice from the same fresh
  URL without no-cache request headers; an edge-cache path needs
  `Cf-Cache-Status: HIT` (or `STALE` / `UPDATING` / `REVALIDATED`) on the second
  GET, an uncached path must never be served from cache. A `private, no-store`
  answer (a preview-safe hostname) reports "cannot prove a HIT here". New exit
  code 7.
- `foundation:check:deployment` gains sub-check 12.7: a wrangler config (any
  scope, JSON or TOML) that sets `"cache": { "enabled": true }` fails against a
  `@narduk-enterprises/narduk-core` older than 2.2.4 — the first core that keeps
  thrown errors, preference-shaped responses and nonce-CSP HTML out of the
  cache. It fails in rollout mode too; with the switch off it is not-applicable.
