---
'@narduk-enterprises/narduk-mapkit': patch
'@narduk-enterprises/narduk-app-tools': minor
'@narduk-enterprises/create-narduk-app': patch
---

Make a local MapKit map easy to get running.

- `narduk-app dev --mapkit -- <command>` runs the child under the shared MapKit
  signing persona (`nvault run -p apple -e prd -c mapkit-signing`), so a map
  app's dev script names no selector. The retired-Doppler migration message now
  names it.
- The Nuxt token route prints a one-time fix to the server console when it
  answers `503` (names the missing `APPLE_*` variables), `500` (key not PKCS#8,
  or a stale value in wrangler vars or `.dev.vars`), or `403` for a loopback
  host that `nardukMapKit.allowedHosts` leaves out. Names only, never values.
- New runbook: `packages/modules/narduk-mapkit/docs/local-development.md`.
