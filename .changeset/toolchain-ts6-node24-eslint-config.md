---
'@narduk-enterprises/eslint-config': patch
'@narduk-enterprises/create-narduk-app': patch
---

Bump the package's own toolchain to the estate baseline (company-hq
D-TOOLCHAIN-1, 2026-09-10): `typescript` `~6.0.3` (was `^5.9.3`), `@types/node`
`^24` (was `^22.19.19`), and every `@typescript-eslint/*` plus
`typescript-eslint` dependency to `^8.70.0` (was `^8.65.0`). `engines.node`
moves to `>=24.0.0`.

No public API or config-output change. `tsconfig.json` gains
`"ignoreDeprecations": "6.0"` because `tsup@8.5.1` injects a deprecated
`baseUrl` into its own DTS build program under TypeScript 6 regardless of this
package's own tsconfig (TS5101); `"types": ["node"]` was already present, so the
TS6 Node-builtins issue (TS2591) that the same migration hit on the superseded
v1 `narduk-eslint-config` line did not recur here.

Consumers pinning `engines.node: >=24.0.0` on install must be on Node 24; anyone
still on Node 22 who picks up this version will hit
`ERR_PNPM_UNSUPPORTED_ENGINE` (a warning under this repo's default
`engine-strict: false`, but a hard failure under a consumer's own strict-engine
setting).

`create-narduk-app` is a generator-owned package whose `src/manifest.ts`
hardcodes the exact `@narduk-enterprises/eslint-config` version newly scaffolded
apps pin (`scripts/sync-generator-package-versions.mjs` keeps it in sync with
each package's own `package.json` version at release time). Releasing
eslint-config `2.0.2` without a matching create-narduk-app release would leave
that pin stale, so this changeset bumps create-narduk-app too -- a
metadata/version sync only. No source, template, or toolchain change to
create-narduk-app itself; it still targets TypeScript 5.9/Node 22 and is
unrelated Wave 1 work.
