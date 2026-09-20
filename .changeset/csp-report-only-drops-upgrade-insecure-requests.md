---
'@narduk-enterprises/narduk-core': patch
---

The report-only CSP no longer carries `upgrade-insecure-requests`.

The preset already meant to keep that directive on the enforcing header only —
browsers ignore it in a report-only policy, and Chromium logs a console error
for every document load. It did that by leaving the key off its own config
object, which is not the same thing: nuxt-security merges our options _over_ its
defaults (`defuReplaceArray(userOptions, defaultSecurityConfig(...))`), and its
default CSP sets `'upgrade-insecure-requests': true`. defu fills in any key we
leave undefined, so the directive came back at full strength and the README's
documented contract — report-only "without `upgrade-insecure-requests`" — was
never what shipped.

The directive is now set explicitly to `false` in report-only mode. defu keeps a
declared `false`, and nuxt-security's serializer drops a false directive rather
than emitting it.

Found on lakestat.us, where enabling the preset turned every page load into a
console error and failed the app's visual-audit E2E suite (18 errors: 6 routes ×
3 viewports). The unit test that covered this asserted the key was _absent_ from
our config object, which is exactly the state that let the default through — so
`nuxt-security-contract.test.ts` now reproduces upstream's own merge with
upstream's own code, rather than asserting on our half of it.
