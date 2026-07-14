interface NardukAiRuntimeConfig {
  /** Private server-only xAI API key. Never place this under runtimeConfig.public. */
  xaiApiKey: string
}

declare module 'nuxt/schema' {
  interface RuntimeConfig extends NardukAiRuntimeConfig {}
}

declare module '@nuxt/schema' {
  interface RuntimeConfig extends NardukAiRuntimeConfig {}
}

export {}
