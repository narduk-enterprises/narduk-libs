---
'@narduk-enterprises/narduk-app-tools': patch
---

Read `GH_PACKAGES_READ` as a registry credential, so `foundation:check` is
decided on the sanctioned local route.

Item 2.3 needs a live packument read to place `narduk-core` in its N-1 window.
`NpmRegistryReality` takes its token from the environment and deliberately from
nowhere else — it reads no `.npmrc` and no `_authToken` line, so that a project
routing the scope elsewhere gets an anonymous read rather than a credential. It
looked for `NODE_AUTH_TOKEN`, `GH_TOKEN` and `GITHUB_TOKEN`.

`gh-packages-run` — the only sanctioned local route, and the one the estate
READMEs name — supplies the value as `GH_PACKAGES_READ` and writes a 0600
process-scoped userconfig referencing it by name, which is what `pnpm install`
needs and which this reader cannot see by design. So the credential was present
in the environment during `gh-packages-run pnpm run foundation:check` and
invisible to the component that needed it: item 2.3 collapsed to `unknown`, and
`UNKNOWN` is a blocking exit. There was no documented local invocation that
produced a decided result (narduk-farm#148).

`GH_PACKAGES_READ` is now last in that chain. Last rather than first keeps the
CI path byte-identical: `nuxt-cloudflare.yml` already aliases the two names to
the same value, and its own comment named this change as the fix — _"Export both
names, same value, until narduk-app-tools reads GH_PACKAGES_READ instead."_ That
alias exists because workflows#79 renamed the exported credential and silently
broke package-token-mode `foundation-check` for every v1 adopter past
`afbaa6051e` (buoys#39). It can retire once callers are past this release.

No new destination for the token: it is still sent only to `npm.pkg.github.com`,
and a mirrored or lookalike scope route still gets an anonymous read.
