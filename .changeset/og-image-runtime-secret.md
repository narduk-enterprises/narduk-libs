---
'@narduk-enterprises/narduk-seo': minor
'@narduk-enterprises/create-narduk-app': patch
---

narduk-seo: a production build no longer needs `NUXT_OG_IMAGE_SECRET`, so CI runners can build the production output without production secrets. The OG image signing secret now resolves per request from the Worker's runtime `NUXT_OG_IMAGE_SECRET`. New Nitro middleware writes it into that request's runtime config, so SSR signing, `/_og/` verification and the preview resolver use one value. With no build secret, the per-build secret nuxt-og-image would generate is blanked rather than baked. A Worker with no runtime secret fails closed: `/_og/` answers 503, and pages emit unsigned OG URLs. A secret supplied at build is still baked as a fallback, and the runtime value wins over it. The CI placeholder refusal and the `.narduk-build-ci` marker are unchanged.

create-narduk-app: the generated Workers Builds runbook now lists `NUXT_OG_IMAGE_SECRET` and `NUXT_SESSION_PASSWORD` as runtime Worker secrets, not build variables.
