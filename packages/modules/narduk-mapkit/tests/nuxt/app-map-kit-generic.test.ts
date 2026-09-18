/**
 * Type-level conformance for `<AppMapKit>`'s generic parameter.
 *
 * 2.1.0 re-typed only `items` on the exported construct signature, so
 * `createPinElement`, `itemKey`, `itemLabel`, `pinGeometry` and the `#callout`
 * slot scope stayed typed against the bare `MapKitPinItem`. Under
 * `strictFunctionTypes` a callback that takes the app's own item type is then
 * NOT assignable to one that takes `MapKitPinItem` -- parameters are
 * contravariant -- which is why the two adopting components in buoys each carry
 * a one-line `as` cast at the call site.
 *
 * A runtime test cannot see any of this: the casts compile away and the values
 * were always correct at runtime. The gate is `pnpm typecheck`, which compiles
 * `tests/**`; a failing assertion below is a compile error naming its own line.
 */
import { describe, expect, it } from 'vitest'

import AppMapKit from '../../src/nuxt/runtime/components/AppMapKit.js'

import type { MapKitCalloutSlotScope } from '../../src/nuxt/runtime/components/AppMapKit.js'
import type { MapKitPinGeometry } from '../../src/nuxt/runtime/pin-geometry.js'
import type { MapKitPinElement, MapKitPinItem } from '../../src/nuxt/runtime/pin-layer.js'

type Expect<T extends true> = T
type Extends<A, B> = [A] extends [B] ? true : false
type Not<T extends boolean> = T extends true ? false : true

/** The shape an adopting app actually has: `MapKitPinItem` plus its own fields. */
interface Station extends MapKitPinItem {
  depth: number
  id: string
  label: string
}

/** A second item type, so "any item type is accepted" cannot pass by accident. */
interface Buoy extends MapKitPinItem {
  name: string
}

type StationInstance = InstanceType<typeof AppMapKit<Station>>
type StationProps = StationInstance['$props']
type StationSlots = StationInstance['$slots']

// ------------------------------------------------------------------- props --

type _items = Expect<Extends<readonly Station[], NonNullable<StationProps['items']>>>
type _createPinElement = Expect<
  Extends<
    (item: Station, isSelected: boolean) => MapKitPinElement,
    NonNullable<StationProps['createPinElement']>
  >
>
type _itemKey = Expect<
  Extends<(item: Station, index: number) => string, NonNullable<StationProps['itemKey']>>
>
type _itemLabel = Expect<Extends<(item: Station) => string, NonNullable<StationProps['itemLabel']>>>
type _pinGeometry = Expect<
  Extends<(item: Station) => MapKitPinGeometry, NonNullable<StationProps['pinGeometry']>>
>

/** A prop the generic does not touch must keep its own type. */
type _ariaLabel = Expect<Extends<NonNullable<StationProps['ariaLabel']>, string>>

// ------------------------------------------------------------------- slots --

type _calloutScope = Expect<
  Extends<
    (scope: MapKitCalloutSlotScope<Station>) => unknown,
    (scope: Parameters<NonNullable<StationSlots['callout']>>[0]) => unknown
  >
>
type _calloutItem = Expect<
  Extends<Parameters<NonNullable<StationSlots['callout']>>[0]['item'], Station>
>

// ------------------------------------------------- the other direction too --
// Without these, widening the generic to `any` would satisfy everything above.

type _wrongLabel = Expect<
  Not<Extends<(item: Buoy) => string, NonNullable<StationProps['itemLabel']>>>
>
type _wrongGeometry = Expect<
  Not<Extends<(item: Buoy) => MapKitPinGeometry, NonNullable<StationProps['pinGeometry']>>>
>
type _wrongItems = Expect<Not<Extends<readonly Buoy[], NonNullable<StationProps['items']>>>>
type _wrongCallout = Expect<
  Not<Extends<Parameters<NonNullable<StationSlots['callout']>>[0]['item'], Buoy>>
>

describe("<AppMapKit>'s generic reaches every item-typed surface", () => {
  it('is enforced at compile time, not here', () => {
    // Vitest needs a runtime case in a .test.ts file; the assertions above are
    // the real gate and run under `pnpm typecheck`.
    expect(AppMapKit).toBeTypeOf('object')
  })
})
