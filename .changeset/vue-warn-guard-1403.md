---
'@narduk-enterprises/narduk-testkit': minor
'@narduk-enterprises/narduk-shell': patch
'@narduk-enterprises/create-narduk-app': patch
---

Make a `[Vue warn]` fail the unit test that caused it (narduk-libs#1403).

`narduk-testkit` gains two Vitest subpaths. `vue-warn-guard`:
`installVueWarnGuard()` from a setup file fails any test during which Vue
warned (an unresolved component, a missing `inject()`, a component with no
render function), with a required-reason `allow` list and a per-test
`allowVueWarning()`. `vue-test-env`: `createVueTestEnv()` installs a memory
router and a `NuxtLink` that renders an `<a href>`, so `UButton` / `ULink` /
`<NuxtLink>` resolve in a plain `mount()` or `createSSRApp()`; `fallback: true`
suits `config.global.plugins`. `vue` and `vue-router` are optional peers.

`narduk-shell`'s `useConfirm()` marks the `body` component raw before it reaches
Nuxt UI's reactive overlay state, so a body dialog no longer makes Vue warn
"a Component that was made a reactive object".
