---
'@narduk-enterprises/narduk-app-tools': minor
'@narduk-enterprises/create-narduk-app': patch
---

Add `narduk-app foundation:check:data-cache` (foundation item 15, #1717). It
warns when a public GET route under `server/api` or `server/routes` reads D1
(directly, or through one helper hop) with no public cache profile and no
`withWorkerCache` / `withKVCache` / `withD1Cache`, and when a page or composable
SSR-fetches such a route without `withWorkerCache`, because an edge profile does
not apply to an in-process call (#1716). Session-bound and admin routes are
exempt, and `// narduk-cache: intentionally-uncached <reason>` suppresses a route
with a recorded reason. It is a warning in rollout mode: always `PASS`, exit
`0`, findings in `advisories` and `findings`. The generated CI does not run it
yet; apps run `pnpm exec narduk-app foundation:check:data-cache`.

The generator's README lists item 15 in its repository-gate table as not run
yet, so its docs name the command an app can run by hand.
