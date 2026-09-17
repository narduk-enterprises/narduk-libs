// Copied only into the disposable consumer. Fontshare initializes an unused
// public catalog during every build; the fixture's Inter/OG fonts still resolve
// through the other providers and remain covered by the browser's asset checks.
// https://fonts.nuxt.com/get-started/providers#custom-providers
export default function consumerSmokeFonts(_options, nuxt) {
  nuxt.hook('fonts:providers', (providers) => {
    delete providers.fontshare
    console.log('[consumer-smoke] Unused Fontshare provider disabled')
  })
}
