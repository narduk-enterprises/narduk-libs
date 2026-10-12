---
'@narduk-enterprises/narduk-testkit': minor
---

Add `vue-strict-setup`, one Vitest `setupFiles` entry for `@vue/test-utils`
suites: `installVueWarnGuard()` plus a default `createVueTestEnv` plugin on
every `mount()`. `vue-strict` exports
`installVueStrict({ allow, stubNames, stubPatterns, ui })` for an app that names
its own components, and `expectVueWarn(pattern, fn)`, which consumes an expected
`[Vue warn]` and fails if it never fires. `createVueTestEnv` now registers
`ClientOnly` and `NuxtImg` and takes `stubNames` / `stubPatterns` (with
`NUXT_UI_PATTERN` and `createStub`) to resolve Nuxt UI `U*` and app components
to a default-slot double. `@vue/test-utils` is a new optional peer.
