interface PluginDefinition {
  name?: string
  setup?: (...args: unknown[]) => unknown
}

export function defineNuxtPlugin<
  _Injections = Record<string, never>,
  T extends PluginDefinition = PluginDefinition,
>(plugin: T): T {
  return plugin
}

export function nextTick(callback?: () => unknown): Promise<unknown> {
  return callback ? Promise.resolve().then(callback) : Promise.resolve()
}

export function useHead(): void {}

export function useRouter() {
  return {
    afterEach: () => null,
  }
}

export function useRuntimeConfig() {
  return {
    public: {
      analyticsLoadStrategy: 'off',
      previewSafeMode: true,
    },
  }
}
