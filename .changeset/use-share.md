---
'@narduk-enterprises/narduk-core': minor
'@narduk-enterprises/create-narduk-app': patch
---

narduk-core: `useShare`, native share with a clipboard fallback and a
cancel-aware outcome (narduk-libs#994). New explicit export
`@narduk-enterprises/narduk-core/app/share`: `share(content, { fallback })`
answers `'shared' | 'copied' | 'cancelled' | 'failed'`. A dismissed sheet is
`'cancelled'` and never overwrites the clipboard. Any other share failure falls
back to the clipboard, and a clipboard refusal is reported. `copy(text)`,
`copied` and a hydration-safe `canNativeShare` come with it; `createSharer` is
the Vue-free half. Nothing is auto-imported.
