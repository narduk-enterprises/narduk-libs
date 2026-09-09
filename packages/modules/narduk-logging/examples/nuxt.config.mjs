import { defineNuxtConfig } from 'nuxt/config'

export default defineNuxtConfig({
  modules: ['@narduk-enterprises/narduk-logging/nuxt'],
  nardukLogging: {
    service: 'example-nuxt',
    environment: 'production',
    level: 'info',
    requestLogging: true,
  },
})
