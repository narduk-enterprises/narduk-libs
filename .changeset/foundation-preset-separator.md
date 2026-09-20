---
'@narduk-enterprises/narduk-app-tools': patch
---

fix(narduk-app-tools): item 1.1 treats `-` and `_` as the same preset separator

Nitro does, and the two spellings reach this check from different places: an
app's `nuxt.config` literal and its `Config/cloudflare-app.json` both say
`cloudflare_module`, while a completed build writes the canonical
`cloudflare-module` into `.output/nitro.json`. Item 1.1 compared the raw string,
so the live-build fallback — the path that exists precisely for an app not yet
onboarded into the deployment standard — failed every app it was meant to serve,
and only after a build had run (narduk-libs#350).

The comparison now normalises the separator on both sides. Nothing else moves: a
genuinely wrong preset (`cloudflare-pages`) still fails, and the FAIL detail now
says the separator is already normalised so the next reader does not re-diagnose
this.
