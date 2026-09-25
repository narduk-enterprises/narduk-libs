---
'@narduk-enterprises/narduk-core': minor
'@narduk-enterprises/create-narduk-app': patch
---

narduk-core: `useStoredState`, a hydration-safe, validated, failure-tolerant
Web Storage ref (narduk-libs#993). New explicit export
`@narduk-enterprises/narduk-core/app/stored-state`: `useStoredState(key, options)`
holds the default on the server and first paint, applies the stored value after
mount, validates it, writes changes back and offers `.clear()`;
`createStoredState` is the Nuxt-free half. Every storage access, including the
`window.localStorage` property itself, is try/caught. `usePersistentTab` now
resolves its storage through the same guarded accessor, so blocked storage no
longer throws from its restore or its write watcher. Nothing is auto-imported.
