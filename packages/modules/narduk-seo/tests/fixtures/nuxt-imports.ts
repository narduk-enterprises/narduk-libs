interface PluginDefinition {
  name?: string
  setup?: (...args: unknown[]) => unknown
}

export function defineNuxtPlugin<T extends PluginDefinition>(plugin: T): T {
  return plugin
}

export function useHead(): void {}

export function useRequestURL(): URL {
  return new URL('https://example.com')
}

export function useRobotsRule(): void {}

export function useRuntimeConfig() {
  return {
    public: {
      nardukSeoHostAwareIndexing: false,
      siteUrl: '',
    },
  }
}
