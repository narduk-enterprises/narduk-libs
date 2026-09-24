---
'@narduk-enterprises/narduk-testkit': minor
'@narduk-enterprises/create-narduk-app': patch
---

The E2E `page` fixture now names the page URL and the mismatched node when Vue
logs a hydration mismatch. An `addInitScript` wraps `console.warn` and
serialises `location.pathname`, the node's `outerHTML`, and its parent as the
warning fires, so a later `goto` cannot drop the details. Apps that build an
E2E artifact can spread `VUE_E2E_HYDRATION_MISMATCH_DETAILS_DEFINE` into
`vite.define` so production Vue keeps those node arguments
(`__VUE_PROD_HYDRATION_MISMATCH_DETAILS__`). `create-narduk-app` is a companion
patch so the generator pin moves with the testkit release.
