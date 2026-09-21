---
'@narduk-enterprises/narduk-seo': patch
'@narduk-enterprises/create-narduk-app': patch
---

Document the `/_og/**` prerender-versus-signing incompatibility in the
narduk-seo README and beside the route rule that causes it, and pin the upstream
mechanism with a regression test. Behaviour is unchanged; a prerendered page
that leaves runtime OG generation on still needs a static card. Refs #170.
