// Copied only into the disposable consumer. Keep the real Nuxt Fonts module and
// CSS integration, but do not initialize remote catalogs in a package smoke.
// https://fonts.nuxt.com/get-started/providers#custom-providers
export default function consumerSmokeFonts(_options, nuxt) {
  nuxt.hook('fonts:providers', (providers) => {
    if (!providers.local) throw new Error('The packed consumer requires the local font provider.')
    for (const name of Object.keys(providers)) {
      if (name !== 'local') delete providers[name]
    }
    console.log('[consumer-smoke] Font providers: local only')
  })
}
