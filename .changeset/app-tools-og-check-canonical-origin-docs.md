---
'@narduk-enterprises/narduk-app-tools': patch
---

`og:check`'s canonical-origin mismatch error now names both the actual and
expected `og:url`, and hints `NUXT_PUBLIC_SITE_URL` for a local `--base-url` run
instead of leaving "og:url does not identify the sampled page on the canonical
origin" with no clue why (#587). Also documents when a page keeps the static
`defaultOgImage` fallback versus getting its own generated image — the rule
follows whether `useSeo` is called (and how), not whether the page is indexed.

Pure diagnostics/docs fix, no public API change.
