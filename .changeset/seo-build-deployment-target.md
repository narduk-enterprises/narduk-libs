---
'@narduk-enterprises/narduk-seo': minor
'@narduk-enterprises/create-narduk-app': patch
---

Add `resolveBuildDeploymentTarget(env?, { productionBranch?, default? })` under
`@narduk-enterprises/narduk-seo/shared/deploymentTarget`, returning
`{ target, source }` from the explicit deploy-target variables, then the Workers
Builds / Pages branch, then a default. The module now falls back to the branch
when no `NARDUK_DEPLOY_TARGET` (or `NUXT_PUBLIC_` equivalent) is set, so a
branch build is noindexed as `preview` and a `main` build counts as
`production` for `hostAwareIndexing` without a `nuxt.config.ts` write-back. A
build with neither variable keeps today's unset target (narduk-libs#999). Apps that
deploy production from another branch set `nardukSeo.productionBranch` (default
`main`).
