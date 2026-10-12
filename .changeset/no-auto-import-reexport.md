---
'@narduk-enterprises/eslint-config': minor
'@narduk-enterprises/create-narduk-app': patch
---

Add `narduk/no-auto-import-reexport` to the `core` pack, at `error`. Nuxt/Nitro
auto-import every export of `server/utils`, `shared/utils`, `app/utils` and
`app/composables`, so `export { x } from './sibling'` in one of those files is a
second export of `x`: unimport keeps one and only warns "Duplicated imports",
`nuxt prepare` still exits 0, and when the two are different functions sharing a
name (operator-portal's `eventBody` and `utcDay`) a caller silently binds to the
wrong one. The message says so and what to do.

The scope is measured on Nuxt 4.5.2, so it reports only collisions:
`server/utils` at any depth, the other three at the top level; type-only named
re-exports included; `export * from`, `export { a as b } from`,
`export * as ns from`, a source outside the scanned set, a re-export across the
app/Nitro scan contexts and a `./dir` source are not reported.

**Breaking for apps that violate it, by design (DESIGN.md, 3.0.0: a rule ships
at the severity it is meant to have and the red upgrade build is the notice).**
Fleet count, over every local checkout in `~/code/narduk-enterprises` on
2026-10-12: 10 files in 3 apps (stonx 7, operator-portal 2, austin-texas-net 1)
and none in this repo. Fix by deleting the re-export and relying on the
auto-import. A minor, not a major: no API changes and no pinned app moves until
it takes the bump. `create-narduk-app` pins this package, so it gets a patch.
