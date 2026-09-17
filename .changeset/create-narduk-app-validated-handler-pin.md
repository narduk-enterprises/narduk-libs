---
'@narduk-enterprises/create-narduk-app': patch
---

Move the generator's pinned `@narduk-enterprises/narduk-core` version — and the
dependent pins that follow it — to the release carrying
`defineValidatedHandler`. The generator emits these versions as string literals,
so Changesets cannot see the coupling and the release-plan gate requires the
generator to move with them. No generator behaviour changes.
