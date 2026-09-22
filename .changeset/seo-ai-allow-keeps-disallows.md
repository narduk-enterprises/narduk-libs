---
'@narduk-enterprises/narduk-seo': patch
---

A `nardukSeo.aiCrawlers` group that names crawlers to **allow** now repeats the
wildcard group's `disallow` paths, including narduk-seo's non-public routes. A
crawler obeys only the most specific group naming it (RFC 9309), so
`{ allow: ['GPTBot'] }` used to emit `User-agent: GPTBot` / `Allow: /` and open
every path the `*` group disallows to GPTBot alone. `'allow'`, `'disallow'`, and
`disallow` lists are unchanged.
