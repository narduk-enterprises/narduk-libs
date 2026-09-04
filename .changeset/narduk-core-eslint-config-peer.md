---
'@narduk-enterprises/narduk-core': patch
---

Move `@narduk-enterprises/eslint-config` out of narduk-core's runtime
`dependencies`. Since 1.20.2 it was pinned there at `workspace:*`, which
publishes as the current eslint-config major, so a patch bump of narduk-core
silently dragged consumers from eslint-config v1 onto v2 and broke `lint` for
anyone who hadn't migrated yet (narduk-libs#154, surfaced by been-sober-for
PR #96).

narduk-core re-exports `eslint-app-config.mjs` and
`eslint-nuxt-flat-fragments.mjs`, which import from
`@narduk-enterprises/eslint-config`, as public subpath exports for consumers'
own ESLint configs, so it is not a pure `devDependency` — it is now an
**optional peerDependency** (`>=1.2.17 <3`), matching the range of
eslint-config majors the re-exported fragments are known to work with. It
also stays a `devDependency` for narduk-core's own `lint`/`build`. Consumers
who don't use those re-exported fragments no longer get eslint-config forced
onto them at all; consumers who do must bring their own compatible
eslint-config version instead of receiving whatever major narduk-core last
published against.
