---
'@narduk-enterprises/narduk-core': patch
'@narduk-enterprises/create-narduk-app': patch
---

Downstream modules can add CSP sources through `nuxt.hook('narduk-core:csp', allow => ...)` without forking the estate policy. The hook is applied before the policy is resolved, and a contribution that arrives too late to merge fails the build instead of silently dropping (narduk-libs#410). `create-narduk-app` is a companion patch so the generator pin moves with core.
