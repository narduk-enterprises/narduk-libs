---
'@narduk-enterprises/narduk-core': minor
'@narduk-enterprises/create-narduk-app': patch
---

Never let a browser cache a missing build asset. A Nuxt app on Workers Static
Assets answers a `/_nuxt/*.js` chunk that a deploy removed with a 404 that
carries Nitro's `_headers` rule for `/_nuxt/*`
(`cache-control: public, max-age=31536000, immutable`), so Safari kept the 404 for
a year and a tab open across a deploy reloaded into the same miss forever. On the
`cloudflare_module` preset, `nitro.entry` now points at a wrapper that runs
Nitro's own entry with an `ASSETS` binding that answers a 404
`cache-control: no-store`; every other status is untouched. Apps that patched
`nitropack` for this can drop the patch.

The swap applies only while the entry is the preset's default. Opt out with
`appConfig.narduk.assetMissNoStore = false`. The pure pieces
(`withUncachedAssetMiss`, `withUncachedAssetMissEnv`,
`withUncachedAssetMissHandler`, `isAssetMissNoStoreEnabled`) are exported from
`@narduk-enterprises/narduk-core/shared/asset-miss-no-store`.
