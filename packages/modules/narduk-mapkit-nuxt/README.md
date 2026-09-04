# @narduk-enterprises/narduk-mapkit-nuxt

Nuxt integration for `@narduk-enterprises/narduk-mapkit`. It adds the
`AppMapKit` and `AppMapKitCallout` components, `useMapKit`, `useMapKitCallouts`,
`useMapkitToken`, and a Worker-compatible `GET /api/mapkit-token` route.

## Install

```sh
pnpm add @narduk-enterprises/narduk-mapkit @narduk-enterprises/narduk-mapkit-nuxt
```

```ts
export default defineNuxtConfig({
  modules: ['@narduk-enterprises/narduk-mapkit-nuxt'],
})
```

The component fills its parent, so the parent must have an explicit height:

```vue
<template>
  <div style="height: 420px">
    <AppMapKit :items="stations" :create-pin-element="createPin" />
  </div>
</template>
```

## Fullscreen

Off by default. Opt in with `fullscreen-control`, and the component renders a
small toggle over the map:

```vue
<AppMapKit
  :items="stations"
  :create-pin-element="createPin"
  fullscreen-control
  fullscreen-mode="viewport"
  @fullscreen-change="(event) => (isFullscreen = event.active)"
/>
```

`fullscreenMode` is `'viewport'` (the default -- a fixed overlay filling the
browser viewport, which works everywhere) or `'fullscreen'` (the Fullscreen API,
falling back to viewport where it is unavailable, with `event.fallback` set).

The component presents its own wrapper, so the map's status overlay and the
toggle come along, and it refreshes MapKit geometry on every change. A template
ref also exposes `enterFullscreen()`, `exitFullscreen()`, `toggleFullscreen()`,
and an `isFullscreen` ref.

Viewport mode positions with `position: fixed`, so no ancestor of the component
may set `transform`, `filter`, `backdrop-filter`, `perspective`, or
`contain: paint` -- any of those becomes the containing block and traps the map
inside it.

## Callouts

Off by default. Opt in with `callouts`, then write the callout's contents as a
slot on `<AppMapKitCallout>` inside the map:

```vue
<script setup lang="ts">
const selectedId = ref<string | null>(null)
</script>

<template>
  <div style="height: 420px">
    <AppMapKit
      v-model:selected-id="selectedId"
      :items="stations"
      :create-pin-element="createPin"
      callouts
    >
      <AppMapKitCallout :items="stations" v-slot="{ item, close }">
        <UCard>
          <template #header>{{ item.name }}</template>
          {{ item.reading }}
          <UButton size="xs" @click="close">Close</UButton>
        </UCard>
      </AppMapKitCallout>
    </AppMapKit>
  </div>
</template>
```

Selecting a pin opens its callout, and dismissing a callout clears the
selection, so the two never disagree. Set `callout-follow-selection="false"` to
drive callouts entirely from the exposed methods instead.

### Nuxt UI inside a callout

The slot is moved into the callout's host element with a `<Teleport>`, not
mounted as a second Vue app, so the content keeps its place in the component
tree. That is what makes Nuxt UI work: `UCard`, `UButton`, `UModal`, and the
rest read their configuration from `<UApp>` through `provide`/`inject`, which a
second app would not see. `useNuxtApp()`, the color mode, route state, and
ordinary reactivity all reach the slot for the same reason.

`:items` on `<AppMapKitCallout>` is optional and never read at runtime; it is
the type witness that lets TypeScript infer the slot's `item`, which a child
cannot pick up from its parent's generic.

### Props, events, and methods

| Prop                     | Default    | Purpose                                                                                                                                                                                                                                                  |
| ------------------------ | ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `callouts`               | `false`    | Opt in. Nothing is constructed until it is `true`.                                                                                                                                                                                                       |
| `calloutMode`            | `'single'` | `'multi'` keeps every open callout open.                                                                                                                                                                                                                 |
| `calloutPlacement`       | `'above'`  | Preferred side; flips when cramped.                                                                                                                                                                                                                      |
| `calloutAnchorOffset`    | derived    | Pixels added to the projected anchor. Defaults to clearing the pin, from `annotationSize`.                                                                                                                                                               |
| `calloutFollowSelection` | `true`     | Bind callouts to `selectedId` in both directions.                                                                                                                                                                                                        |
| `calloutOptions`         | --         | The rest of the controller's options: `gap`, `edgePadding`, `flip`, `caretSize`, `closeOnEscape`, `closeOnMapClick`, `closeOnPan`, `closeOnDeselect`, `focusOnOpen`, `restoreFocus`, `role`, `ariaLabel`, `zIndex`, `hideOffscreen`, `keyForAnnotation`. |

Events: `callout-open` (also fired when an open callout is re-opened with new
data) and `callout-close`. Both carry `{ item, key, phase, reason }`.

A template ref exposes `openCallout(key)`, `closeCallout(key)`,
`closeCallouts()`, and `getCalloutController()`. Inside the map's own subtree,
`useMapKitCallouts()` returns the same controls plus the reactive `entries`
list, for a legend row or a keyboard shortcut that opens a callout.

### Styling

The component styles only the caret and leaves the callout's surface to the slot
content, so a `UCard` is not stacked on a second background. Match the caret to
that surface with custom properties on the map or any ancestor:

```css
.map-wrapper {
  --mapkit-callout-caret-background: var(--ui-bg);
  --mapkit-callout-caret-border: var(--ui-border);
  --mapkit-callout-caret-size: 10px;
  --mapkit-callout-max-width: 22rem;
}
```

## Token route

Runtime names accepted by the token route:

- `APPLE_PRIVATE_KEY` or `APPLE_SECRET_KEY`
- `APPLE_TEAM_ID`
- `APPLE_KEY_ID`
- `MAPKIT_ALLOWED_ORIGINS`
- `APPLE_MAPKIT_TOKEN` or `MAPKIT_TOKEN`

Cloudflare bindings are read from the request-scoped Nitro context. Nuxt
runtime-config equivalents (`applePrivateKey`, `appleSecretKey`, `appleTeamId`,
`appleKeyId`, `mapkitAllowedOrigins`, and `public.mapkitToken`) are supported as
fallbacks. Missing credentials return `503` with `{ configured: false }`. The
generated endpoint accepts GET only; other methods return `405` with
`Allow: GET`.

Provider-specific rate limiting remains app-owned. A server middleware can set
the request-scoped hook before the package route runs:

```ts
export default defineEventHandler((event) => {
  event.context.nardukMapKit = {
    rateLimit: async ({ origin }) => {
      const allowed = await consumeAppRateLimit(origin)
      return allowed
        ? { allowed: true }
        : { allowed: false, retryAfterSeconds: 60 }
    },
  }
})
```

The hook is optional so apps can instead enforce Cloudflare rate-limiting rules
at the edge. A denied hook response is `429` and may include `Retry-After`.

## Options

```ts
export default defineNuxtConfig({
  nardukMapKit: {
    component: true,
    composables: true,
    tokenRoute: true,
    tokenRoutePath: '/api/mapkit-token',
  },
})
```

Disable `tokenRoute` when the app provides its own endpoint. Override
`public.mapkitTokenEndpoint` when composables should call a different route.
