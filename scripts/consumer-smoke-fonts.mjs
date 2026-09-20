// Copied only into the disposable consumer. Fontshare and Bunny each
// initialize an unused public catalog during every build; the fixture's
// Inter/OG fonts still resolve through the other providers and remain covered
// by the browser's asset checks.
//
// Bunny joined Fontshare here after run 35514181971, where a single
// `[warn] Could not fetch from https://fonts.bunny.net/list. Will retry in
// 1000ms. 3 retries left.` failed `packed-consumer-smoke` -- and with it the
// `verify` gate -- on a build that otherwise succeeded in 49.1s and pulled
// every font it actually uses from fonts.gstatic.com. Reaching a third-party
// catalog the app never consults is not something this gate should be able to
// go red on, and removing the call is strictly better than teaching
// consumer-smoke-output.mjs to tolerate the warning: there is then no request
// to be flaky.
// https://fonts.nuxt.com/get-started/providers#custom-providers
const unusedCatalogProviders = ['fontshare', 'bunny']

export default function consumerSmokeFonts(_options, nuxt) {
  nuxt.hook('fonts:providers', (providers) => {
    const removed = unusedCatalogProviders.filter((name) => delete providers[name])
    // release-packages.mjs matches this prefix to prove the fixture ran at
    // all. Naming what was removed keeps the two from drifting silently the
    // way the old single-provider message did.
    console.log(`[consumer-smoke] Unused font catalog providers disabled: ${removed.join(', ')}`)
  })
}
