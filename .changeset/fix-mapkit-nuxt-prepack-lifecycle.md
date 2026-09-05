---
'@narduk-enterprises/narduk-mapkit-nuxt': patch
---

Fix `changeset publish` still failing to build
`@narduk-enterprises/narduk-mapkit-nuxt` after the prior 2.0.2 attempt (release
run 33938838208).

The prior fix added a `preprepack` script mirroring the package's existing
`prebuild` hook, on the assumption that npm/pnpm's `pre<script>` chaining would
run it before `prepack`. That chaining only applies when a script name is
invoked generically (`pnpm run prepack`); `prepack` is a reserved lifecycle
event that `npm publish`/`pnpm pack` invoke directly, bypassing it, so
`preprepack` never ran during the real publish path and the same
`TSConfckParseError: failed to resolve "extends":"./.nuxt/tsconfig.json"`
recurred. Folded `nuxt-module-build prepare` directly into the `prepack` script
itself, verified with a from-clean `pnpm pack --dry-run` and
`npm pack --dry-run` (not `pnpm run prepack`, which would mask this class of bug
again).
