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

export function computed<T>(getter: () => T): { value: T } {
  return {
    get value() {
      return getter()
    },
  }
}

export function toValue<T>(source: T | (() => T)): T {
  return typeof source === 'function' ? (source as () => T)() : source
}

export function useAsyncData<T>(
  _key: string | (() => string),
  handler: () => Promise<T>,
  options?: { default?: () => T; watch?: unknown[] },
) {
  return {
    data: { value: options?.default?.() },
    execute: handler,
    refresh: handler,
  }
}

interface FixtureNuxtApp {
  $posthog?: unknown
}

let fixtureNuxtApp: FixtureNuxtApp = {}

/** Test-only hook: lets a test seed the value `useNuxtApp()` returns. */
export function __setFixtureNuxtApp(app: FixtureNuxtApp): void {
  fixtureNuxtApp = app
}

export function useNuxtApp(): FixtureNuxtApp {
  return fixtureNuxtApp
}
