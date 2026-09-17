/**
 * The `#imports` seam, for tests only.
 *
 * `#imports` is Nuxt's virtual module: it exists inside a Nuxt build and
 * nowhere else. `vitest.config.ts` aliases it here so the published runtime can
 * be driven by a plain unit test without standing up a Nuxt app, which is the
 * whole point of keeping the decisions in framework-free controllers.
 *
 * This file is deliberately NOT a mock of Nuxt: `useHead` records what the
 * component asked the document head for, and `useRuntimeConfig` returns exactly
 * what the module would have published. Both are what the assertions read.
 */

export interface NuxtHeadInput {
  script?: Array<Record<string, unknown>>
}

export interface NuxtRuntimeConfigStub {
  [key: string]: unknown
  public: Record<string, unknown>
}

/** Every `useHead()` call the runtime made, oldest first. */
export const headEntries: NuxtHeadInput[] = []

let runtimeConfig: NuxtRuntimeConfigStub = { public: {} }

export function setTestRuntimeConfig(config: NuxtRuntimeConfigStub): void {
  runtimeConfig = config
}

export function resetNuxtImportsStub(): void {
  headEntries.length = 0
  runtimeConfig = { public: {} }
}

export function useHead(input: NuxtHeadInput): void {
  headEntries.push(input)
}

export function useRuntimeConfig(): NuxtRuntimeConfigStub {
  return runtimeConfig
}
