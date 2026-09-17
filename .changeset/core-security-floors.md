---
'@narduk-enterprises/narduk-core': patch
---

Record the three published `dependencies` floors narduk-core raised to reach the
estate security bar. All three are runtime `dependencies`, so the fix only
reaches a consumer through a release; none of them is a widening, and none
crosses a major.

`undici` `^8.1.0` → `^8.9.0` closes GHSA-4cwx-7wf7-3272 (high, "cross-user
information disclosure and parse-time crash via degenerate private cache
directives", vulnerable `>=8.0.0 <8.9.0`). `8.9.0` also closes four moderates on
the same range: GHSA-8xcm-r25x-g524 (retry-interceptor response
desynchronization), GHSA-jr45-8vmc-qm54 (whitespace around equals in
`Cache-Control`), GHSA-m8rv-5g2x-5cg5 (CRLF injection via a blob-like body
`type`) and GHSA-v3r7-h72x-cjcm (cookie attribute injection). `8.9.0` is a minor
inside the already-declared `^8` major, and narduk-core's call sites — `fetch`,
`Agent`, `ProxyAgent` and `setGlobalDispatcher` — are unchanged across it.

`postcss` `^8.5.14` → `^8.5.18` closes GHSA-r28c-9q8g-f849 (high, "Path
Traversal in Previous Source Map Auto-Loading (sourceMappingURL) leads to
Arbitrary .map File Disclosure", vulnerable `<=8.5.17`). A moderate on the same
package, GHSA-fxqj-rqcc-2cmp (`<=8.5.22`, incomplete fix of
GHSA-6g55-p6wh-862q), is below the bar and stays open at this floor.

`@nuxt/image` `^2.0.0` → `^2.1.0` is what closes the two high `sharp`
advisories, GHSA-f88m-g3jw-g9cj (libvips CVE-2026-33327, CVE-2026-33328,
CVE-2026-35590, CVE-2026-35591, fixed in `0.35.0`) and GHSA-rgj7-g3m4-5g8c
(libheif GHSA-g89c-p67h-r497 and GHSA-2jg2-4ch7-h545, fixed in `0.35.4`).
`sharp` reaches narduk-core only through `@nuxt/image`'s optional `ipx`:
`@nuxt/image@2.0.0` pairs with `ipx@3.1.1`, which declares `sharp: ^0.34.3` and
resolved to the vulnerable `0.34.5`; `@nuxt/image@2.1.0` pairs with
`ipx@4.0.0-beta.1`, which declares `sharp: ^0.35.3` and resolves to `0.35.4`.
Raising the floor is therefore load-bearing, not cosmetic — leaving `^2.0.0` in
place lets a fresh lockfile resolve back onto the vulnerable `sharp` line.
`sharp@0.35` raises its Node floor to `>=20.9.0`; the estate runs Node 24, and
`ipx` is optional, so no supported consumer loses a platform.

`pnpm audit --audit-level high` reports zero high or critical advisories at this
floor.
