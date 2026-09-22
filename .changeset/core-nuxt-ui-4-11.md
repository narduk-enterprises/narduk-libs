---
'@narduk-enterprises/narduk-core': minor
'@narduk-enterprises/narduk-shell': minor
'@narduk-enterprises/narduk-ai': patch
'@narduk-enterprises/design-system-build': patch
'@narduk-enterprises/create-narduk-app': patch
---

Bump `@nuxt/ui` from `4.8.1` to `4.11.1` everywhere the layer pins it: the
`narduk-core` dependency, the `narduk-shell` peer and dev pins, the `narduk-ai`
and `design-system-build` dev pins, and the `create-narduk-app` generator
manifest (following the same coordinated-pin pattern as 8f693b1).

A consumer app already on `@nuxt/ui@4.11.1` (buoys#287) failed `nuxt typecheck`
against narduk-core's `AppTabs.vue`:

```
error TS2345: Argument of type '{ ... items: TabsItem[] | undefined; ... }' is
not assignable to parameter of type '... items?: TabsItem[] | undefined; ...'.
  Type 'import(".../@nuxt+ui@4.8.1/.../Tabs.d.vue").TabsItem[] | undefined' is
  not assignable to type 'import(".../@nuxt+ui@4.11.1/.../Tabs.d.vue").TabsItem[]
  | undefined'.
```

Two different `@nuxt/ui` installs (narduk-core's pinned `4.8.1` and the app's
own `4.11.1`) produced structurally distinct `TabsItem`/`AvatarProps` types that
TypeScript will not unify, even though both come from the same package name.
Matching narduk-core's declared version to the app's removes the duplicate-copy
mismatch.

`nuxt typecheck` passes clean in narduk-core against `4.11.1` with no source
changes; no other breaking change between `4.8.1` and `4.11.1` touched anything
in this workspace.

Consumer migration: an app that declares `@nuxt/ui` itself must move its own pin
to `4.11.1` in the same change that takes this release. `narduk-shell`'s peer is
exact, so any other version is a peer conflict, and `narduk-core` carries
`@nuxt/ui` as a dependency, so a different app-level pin resolves a second copy
-- the duplicate-copy failure this release removes.

Refs narduk-enterprises/buoys#287.
