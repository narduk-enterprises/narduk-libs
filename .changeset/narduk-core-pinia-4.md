---
'@narduk-enterprises/narduk-core': major
---

Move the Pinia stack to `pinia` 4 and `@pinia/nuxt` 1 in one step. narduk-core
now depends on `pinia` `^4.0.3`, `@pinia/nuxt` `^1.0.2` and `@vue/devtools-api`
`^8.1.5`. Pinia 4 no longer installs `@vue/devtools-api` for you, so narduk-core
now lists it.

Store APIs do not change. Pinia 4's breaking changes are all packaging:

- it is ESM-only;
- it requires `@vue/devtools-api` 8 installed alongside it;
- its optional TypeScript peer is now `>=5.6`.

`@pinia/nuxt` 1.0 has no option or runtime changes. It now carries its own
`@nuxt/kit` `^4.4.8` and supports Nuxt `^3.15.0 || ^4.0.0 || ^5.0.0`.

This is a major release because apps that list `pinia` themselves must move that
pin at the same time. If an app keeps `pinia` 3, it installs two Pinia copies.
`@pinia/nuxt` then creates and installs the Pinia instance from one copy, while
the app's `defineStore()` comes from the other. Each copy has its own injection
symbol and active instance. In a production client bundle, the first store call
throws `Cannot read properties of undefined (reading '_s')`. The page then
renders the error page and reports hydration mismatches, as seen in buoys#75.

Consumer migration:

- Adopt this narduk-core together with every other `@narduk-enterprises/*`
  package from the same release. Update any `pnpm.overrides` entry that pins
  narduk-core too.
- If the app lists `pinia`, move it to `^4.0.3` in the same change. If it lists
  `@pinia/nuxt`, move it to `^1.0.2`. An app that never imports from `pinia`
  directly can drop that dependency and use the auto-imports.
- If the app uses `@pinia/testing`, move it to `^2`. Version 2 is ESM-only and
  needs `pinia >=4.0.2`.
- Import `pinia` only through ESM `import`, because there is no CommonJS build.
- After installing, `pnpm-lock.yaml` must contain exactly one `pinia@4` snapshot
  and no `pinia@3` or `@pinia/nuxt@0.x` entry. Two `pinia@4.0.3` snapshots with
  different peer suffixes are still two runtime copies.
- Before merging, run the app's hydration and store-backed E2E specs against a
  production build. The failure only shows up in the built client bundle.
