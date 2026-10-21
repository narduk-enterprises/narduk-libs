---
'@narduk-enterprises/narduk-shell': minor
'@narduk-enterprises/narduk-seo': minor
'@narduk-enterprises/libs-explorer': patch
'@narduk-enterprises/eslint-config': patch
'@narduk-enterprises/narduk-app-tools': patch
'@narduk-enterprises/create-narduk-app': patch
---

Add the round-8 feel primitives to narduk-shell: `useUndoToast()` (a 7 second Undo toast with a countdown bar and a promise of `undone` or `committed`, on the Nuxt UI toaster), `useTimeAgo()` and `NeRelativeTime` (one shared 30 second ticker, `<time datetime>` with an absolute title, relative while recent and a date after a week), `NePriceCell` (a fixed-width tabular figure whose up/down tint changes colour only), `NeStickyActionBar` (the phone bottom call to action with safe-area padding and a matching spacer), `NeTabs` and `useRouteTab()` (`?tab=` kept with `router.replace`, roving focus, the active tab scrolled into view), a global `:focus-visible` ring (2px accent outline, 2px offset) and the `.ne-safe-top` / `.ne-safe-bottom` utilities. Every addition is new surface; no existing export changes. Add `usePageSeo()` and `buildPageTitle()` to narduk-seo for the `Page · Site` browser title. Update the shared-component inventories and Explorer examples.
