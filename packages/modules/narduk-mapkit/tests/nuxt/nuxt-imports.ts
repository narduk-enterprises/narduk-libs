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

/** The one method of a real `unhead` instance the stub forwards to. */
export interface TestHead {
  push: (input: NuxtHeadInput) => unknown
}

let liveHead: TestHead | null = null

/**
 * Route `useHead()` into a real `unhead` head as well as `headEntries`.
 *
 * narduk-libs#469: the second `mapkit.core.js` came from unhead's client DOM
 * renderer, not from Apple's loader, so a test about "how many script tags
 * end up in the document" has to run the real renderer. Nuxt's head IS an
 * unhead instance; this is the seam that lets a test install one.
 */
export function installTestHead(head: TestHead | null): void {
  liveHead = head
}

let runtimeConfig: NuxtRuntimeConfigStub = { public: {} }

export function setTestRuntimeConfig(config: NuxtRuntimeConfigStub): void {
  runtimeConfig = config
}

export function resetNuxtImportsStub(): void {
  headEntries.length = 0
  liveHead = null
  runtimeConfig = { public: {} }
}

export function useHead(input: NuxtHeadInput): void {
  headEntries.push(input)
  liveHead?.push(input)
}

export function useRuntimeConfig(): NuxtRuntimeConfigStub {
  return runtimeConfig
}
