---
'@narduk-enterprises/narduk-app-tools': patch
'@narduk-enterprises/narduk-testkit': patch
'@narduk-enterprises/create-narduk-app': patch
---

Raise the `sharp` runtime dependency from `^0.34.5` to `^0.35.4` in
`narduk-app-tools` and `narduk-testkit`, and release the generator so its
hard-coded pins for both packages move with them.

`sharp` is a published runtime `dependencies` entry in both packages, so the fix
only reaches consumers through a release. `0.35.4` closes two high-severity
inherited advisories: GHSA-f88m-g3jw-g9cj (libvips CVE-2026-33327,
CVE-2026-33328, CVE-2026-35590, CVE-2026-35591, fixed in 0.35.0) and
GHSA-rgj7-g3m4-5g8c (libheif GHSA-g89c-p67h-r497 and GHSA-2jg2-4ch7-h545, fixed
in 0.35.4).

`sharp@0.35` raises its Node floor to `>=20.9.0` and drops the `install` script,
so a platform without a prebuilt `@img/sharp-*` binary must now fall back to
WebAssembly or build libvips by hand. Neither package declares `engines`, and
the estate runs Node 24, so no supported consumer loses a platform. The call
sites — `metadata()`, `stats()`, `resize()`, `toFormat()`,
`ensureAlpha().raw()`, `failOn` and `limitInputPixels` — are unchanged in
0.35.x; the removed `failOnError` and `paletteBitDepth` APIs were never used.
