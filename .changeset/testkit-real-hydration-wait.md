---
'@narduk-enterprises/narduk-testkit': minor
'@narduk-enterprises/create-narduk-app': patch
---

Add `waitForVueHydrated(page)`, a real hydration barrier. It waits until the Vue
app has mounted and Nuxt's `isHydrating` is `false`. `waitForHydration` only
ever waited for the document `load` event, which on a Nuxt page fires before
hydration. It is now deprecated with unchanged behaviour, and `waitForPageLoad`
is the same wait under an accurate name. The shared auth, notifications and
user-profile contract suites, and the generator's e2e fixtures and audit spec,
now use `waitForVueHydrated`.
