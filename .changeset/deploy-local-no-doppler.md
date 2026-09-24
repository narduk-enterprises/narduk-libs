---
'@narduk-enterprises/narduk-app-tools': minor
---

`narduk-app deploy-local` no longer reads Doppler `narduk/tokens`: Doppler is
retired except the `ne` root store. It takes `GH_PACKAGES_READ`,
`NUXT_OG_IMAGE_SECRET` and `NUXT_SESSION_PASSWORD` (or the list in
`NARDUK_APP_SECRET_KEYS`, formerly `NARDUK_APP_DOPPLER_KEYS`, still honoured)
from its environment and fails closed, naming the missing keys and the
`nvault run -- narduk-app deploy-local` route, when any is absent.
`buildMergedDeployEnv` takes `secrets` instead of `dopplerSecrets`.
`narduk-app doctor` checks for `nvault` on PATH instead of `doppler`.
