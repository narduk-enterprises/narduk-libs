import type { H3Event } from 'h3'
import type { NitroAppPlugin } from 'nitropack'

/**
 * Stand-in for `nitropack/runtime` inside `tsconfig.consumer-server.json`.
 *
 * A consumer's server program types `useRuntimeConfig` as `@nuxt/schema`'s
 * `RuntimeConfig` (`Record<string, unknown>`), not as this package's
 * augmentation. Nitropack's own un-augmented `NitroRuntimeConfig` is
 * `[key: string]: any`, which would hide the TS2538 this gate exists to
 * catch, so the double returns the consumer's view on purpose.
 *
 * `defineNitroPlugin` keeps Nitro's real `NitroAppPlugin` so hook callbacks
 * are contextually typed the way they are in a consumer. Importing `nitropack`
 * (not `nitropack/runtime`, which this project path-maps to this file) also
 * applies Nitro's `ImportMeta` and `H3Event.fetch` augmentations.
 */
export interface ConsumerRuntimeConfig extends Record<string, unknown> {
  public: Record<string, unknown>
}

export function useRuntimeConfig(event?: H3Event): ConsumerRuntimeConfig {
  void event
  return { public: {} }
}

export function defineNitroPlugin(plugin: NitroAppPlugin): NitroAppPlugin {
  return plugin
}
