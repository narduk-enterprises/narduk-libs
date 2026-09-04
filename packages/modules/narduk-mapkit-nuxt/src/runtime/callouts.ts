/**
 * The contract `AppMapKit` provides and `AppMapKitCallout` injects.
 *
 * `AppMapKit` owns the headless `MapKitCalloutController` and the DOM hosts it
 * creates; `AppMapKitCallout` owns what goes inside them. Keeping the two
 * apart is what lets consumer content be an ordinary Vue subtree -- teleported
 * into a host rather than mounted as a second app -- so `provide`/`inject`,
 * `useNuxtApp()`, and the Nuxt UI config all still reach it.
 *
 * `item` is `unknown` here on purpose. An `InjectionKey` is invariant in its
 * type parameter, so a generic context would force a cast at every provide
 * site; `AppMapKitCallout` narrows it once, where the component's own generic
 * says what the items are.
 */
import type { InjectionKey, Ref } from 'vue'

/** One open callout: its key, its data, and the element to render into. */
export interface AppMapKitCalloutEntry {
  /** The controller-owned element content is teleported into. */
  host: HTMLElement
  item: unknown
  key: string
}

export interface AppMapKitCalloutContext {
  /** Close one callout, or every open callout when the key is omitted. */
  close: (key?: string) => void
  /** Open callouts, in the order they opened. */
  entries: Ref<AppMapKitCalloutEntry[]>
  /** Open the callout for an item id already passed to `AppMapKit`. */
  open: (key: string) => void
  /** Re-measure and re-place every open callout on the next animation frame. */
  reposition: () => void
}

export const appMapKitCalloutInjectionKey: InjectionKey<AppMapKitCalloutContext> = Symbol(
  'narduk-mapkit-callouts',
)
