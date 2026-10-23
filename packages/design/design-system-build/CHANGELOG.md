# @narduk-enterprises/design-system-build

## 0.1.3

### Patch Changes

- 5ee4d42: narduk-app: apiErrorMessage ignores a non-string message, and
  readAppCookie keeps the first duplicate, unquotes values and cannot return a
  prototype member. create-narduk-app: the database flag is read past comments
  in either quote style, the GitHub Packages Dependabot file carries the
  toolchain ceilings and cooldown exclusion, `narduk:unmanaged` now protects
  package.json, and upgrade no longer throws on a scoped name, a low
  localDevNuxtPort or an uppercase capability. narduk-ui: a missing tile's
  reason is not colored as a change, an unknown chip state renders void, and a
  bad `decimals` falls back instead of throwing. narduk-charts: README and
  SECURITY now describe the pnpm workflow. design-system-build: the preview
  sanitizer rejects every @import, remote url() and external form/href/srcset, a
  planned card must author and render its own id, a failed swap keeps the
  previous preview, and a stale .output is refused.

## 0.1.2

### Patch Changes

- 056105e: Bump `@nuxt/ui` from `4.8.1` to `4.11.1` everywhere the layer pins
  it: the `narduk-core` dependency, the `narduk-shell` peer and dev pins, the
  `narduk-ai` and `design-system-build` dev pins, and the `create-narduk-app`
  generator manifest (following the same coordinated-pin pattern as 8f693b1).

  A consumer app already on `@nuxt/ui@4.11.1` (buoys#287) failed
  `nuxt typecheck` against narduk-core's `AppTabs.vue`:

  ```
  error TS2345: Argument of type '{ ... items: TabsItem[] | undefined; ... }' is
  not assignable to parameter of type '... items?: TabsItem[] | undefined; ...'.
    Type 'import(".../@nuxt+ui@4.8.1/.../Tabs.d.vue").TabsItem[] | undefined' is
    not assignable to type 'import(".../@nuxt+ui@4.11.1/.../Tabs.d.vue").TabsItem[]
    | undefined'.
  ```

  Two different `@nuxt/ui` installs (narduk-core's pinned `4.8.1` and the app's
  own `4.11.1`) produced structurally distinct `TabsItem`/`AvatarProps` types
  that TypeScript will not unify, even though both come from the same package
  name. Matching narduk-core's declared version to the app's removes the
  duplicate-copy mismatch.

  `nuxt typecheck` passes clean in narduk-core against `4.11.1` with no source
  changes; no other breaking change between `4.8.1` and `4.11.1` touched
  anything in this workspace.

  Consumer migration: an app that declares `@nuxt/ui` itself must move its own
  pin to `4.11.1` in the same change that takes this release. `narduk-shell`'s
  peer is exact, so any other version is a peer conflict, and `narduk-core`
  carries `@nuxt/ui` as a dependency, so a different app-level pin resolves a
  second copy -- the duplicate-copy failure this release removes.

  Refs narduk-enterprises/buoys#287.

## 0.1.1

### Patch Changes

- 8f693b1: Pin `@nuxt/ui` at `4.8.1` everywhere the layer pins it: the
  `narduk-core` dependency, the `narduk-shell` peer and dev pins, the
  `narduk-ai` and `design-system-build` dev pins, and the `create-narduk-app`
  generator manifest.

  `@nuxt/ui` 4.6.1 added `build.transpile.push('reka-ui')` (nuxt/ui#6286), which
  makes Vite bundle `reka-ui` per importer on the server as well as the client.
  Without it, an app that also declares `reka-ui` directly renders SSR markup
  from its own copy while hydrating against Nuxt UI's pinned copy, which
  produced the `Hydration node mismatch` failures in buoys. 4.8.1 also carries
  the fix for GHSA-gj2h-2fpw-fhv9 (medium, `@nuxt/ui < 4.8.1`) and widens the
  `typescript` peer to `^5.6.3 || ^6.0.0`. The only breaking change between
  4.6.0 and 4.8.1 is `UInputMenu`'s `autocomplete` prop being renamed to `mode`,
  which nothing in this workspace uses.

  Consumer migration: an app that declares `@nuxt/ui` itself must move its own
  pin to `4.8.1` in the same change that takes this release. `narduk-shell`'s
  peer is exact, so any other version is a peer conflict, and `narduk-core`
  carries `@nuxt/ui` as a dependency, so a different app-level pin resolves a
  second copy — the duplicate-copy failure this release removes.
