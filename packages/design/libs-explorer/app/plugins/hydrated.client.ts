/*
 * Marks the document once the app is interactive. Until then a prerendered
 * button is only HTML: a click does nothing. The browser tests wait for this
 * mark instead of sleeping.
 */
export default defineNuxtPlugin((nuxtApp) => {
  nuxtApp.hook('app:mounted', () => {
    document.documentElement.dataset.hydrated = 'true'
  })
})
