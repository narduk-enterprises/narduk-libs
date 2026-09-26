/**
 * Written into the consumer's Nuxt types only when `nuxt-og-image` is not
 * installed. The peer's module owns `ogImage` once it is installed, and a
 * second declaration of that key fails the NuxtConfig merge (narduk-libs#1162).
 */
export const OG_IMAGE_NUXT_CONFIG_DECLARATION = `interface NardukSeoOgImageConfig {
  enabled?: boolean
  zeroRuntime?: boolean
  includeTwitter?: boolean
  [key: string]: unknown
}

declare module '@nuxt/schema' {
  interface NuxtConfig {
    ogImage?: NardukSeoOgImageConfig | false
  }
  interface NuxtOptions {
    ogImage?: NardukSeoOgImageConfig | false
  }
}

declare module 'nuxt/schema' {
  interface NuxtConfig {
    ogImage?: NardukSeoOgImageConfig | false
  }
  interface NuxtOptions {
    ogImage?: NardukSeoOgImageConfig | false
  }
}

export {}
`
