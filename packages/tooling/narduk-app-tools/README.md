# @narduk-enterprises/narduk-app-tools

## Social preview checks

`narduk-app og:generate` renders an app-owned default share image.
`narduk-app og:check` validates the default and route inventory; add `--live` to
verify actual server-rendered metadata and downloaded images as crawlers. New
app scaffolds wire these into builds and browser CI. Existing apps adopt them
using the [social preview guide](docs/social-previews.md).

Focused app-local tooling exposed as `narduk-app`. It operates on the current
application only: local development, source-owned D1 migrations, guarded
Wrangler deployment, registry authentication, diagnostics, performance budgets,
and favicon assets.

## Local development (`narduk-app dev`)

```sh
narduk-app dev [--credentials <none|nvault>] [--project <name>] \
  [--environment <name>] [--config <name>] [--dry-run] -- <command...>
```

The command runs one child process. Without `--credentials` it runs that child
directly, so an app whose local development needs no secrets has no secret-store
dependency at all. The child defaults to `nuxt dev`.

`--credentials nvault` is the registered local credential route. It requires a
complete selector and runs
`nvault run -p <project> -e <environment> -c <config> -- <command>`, so values
stay process-local for that one run and are never written to a file (company-hq
[`docs/SECRETS-MATRIX.md`](https://github.com/narduk-enterprises/company-hq/blob/main/docs/SECRETS-MATRIX.md),
plane 4 "Local workstation overlay"). A partial selector is refused by name
rather than resolved to some nearby scope. `--dry-run` prints the exact command
without running it.

### Migrating off the retired Doppler wrapper

Before 0.4.0 this command always ran its child through `doppler run`, and
`--project` / `--config` selected a Doppler project and config — an implicit
dependency on the retired app-secret store (narduk-libs#321). That route is
gone: the old invocation now fails with the migration message below rather than
silently starting a dev server without the environment it used to receive.

| Before                                                    | After                                                                                                          |
| --------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `narduk-app dev --project <app> --config dev -- nuxt dev` | no secrets needed: `nuxt dev` (or `narduk-app dev -- nuxt dev`)                                                |
| `narduk-app dev --project <app> --config dev -- nuxt dev` | secrets needed: `narduk-app dev --credentials nvault --project <p> --environment <e> --config <c> -- nuxt dev` |

Choosing the second form needs a real nvault project, environment and config for
the app; adopt them with the `adopt-nvault` workflow rather than guessing a
selector. Doppler `ne/*` root provisioners remain a separately approved
provider-root exception and are **not** an application development credential
source.

`narduk-app deploy-local` is a different command and still reads Doppler
`narduk/tokens` for its recovery deploy; it is unchanged here.

## Migration config

`narduk-app db migrate` accepts a JSON config with explicit source names and
versions. Paths are relative to the config file:

```json
{
  "schemaVersion": 1,
  "sources": [
    {
      "id": "@narduk-enterprises/narduk-core",
      "dir": "node_modules/@narduk-enterprises/narduk-core/runtime/drizzle"
    },
    {
      "id": "@narduk-enterprises/narduk-auth",
      "dir": "node_modules/@narduk-enterprises/narduk-auth/drizzle"
    },
    {
      "id": "app",
      "dir": "drizzle"
    }
  ],
  "adoptions": []
}
```

Package sources are applied before `app`. The ledger uses `(source, filename)`
as its primary key and stores the SHA-256 SQL checksum. When the canonical
manifest omits a source version, the command resolves it from the owning
package's `package.json` (including the app package) before planning; it never
writes `unversioned` to a ledger. Existing ambiguous rows are refused unless an
adoption entry names the exact target checksum and proves the expected schema
tables, columns, and indexes. A migration and its ledger row are submitted in
the same D1 batch so a failed statement rolls back the batch.

Before any remote mutation, the command fails closed unless it can capture a D1
Time Travel bookmark, current migration ledgers, and `sqlite_master` metadata.
The mode-`0600` recovery artifact is written under `.narduk/recovery/d1/` and
its path is printed by the CLI. Remote reset is never supported; corrective
database changes are forward-only.

Only numbered migration files such as `0000_initial_schema.sql` or `0001.sql`
are discovered. Utility SQL such as `seed.sql` is deliberately excluded and is
never executed against local or remote application databases by this command.

App Worker configuration may use `wrangler.jsonc` (preferred) or legacy
`wrangler.json`. All Wrangler calls run through the app's pinned dependency via
`pnpm exec wrangler`. Dry runs are allowed without credentials or the local
deployment override. Production and preview deploys are allowed in Cloudflare
Workers Builds only when its injected `CI`, `WORKERS_CI`, build UUID, commit
SHA, and branch variables form a complete attestation. A real local deploy
requires the explicit `NARDUK_ALLOW_LOCAL_WRANGLER_DEPLOY=1` recovery opt-in;
unrelated environment flags never bypass that guard. A package-manager
passthrough separator is normalized before invoking Wrangler so it cannot
neutralize `--dry-run`.

Generated Workers Builds scripts pass `--workers-build-only` to the remote
migration command. That attestation is checked before D1 recovery capture or
mutation, so invoking the production script locally cannot migrate a remote
database and then fail only at the deploy step.

The command never writes secret files. Registry auth writes the requested
`.npmrc.auth` path and scopes GitHub Packages to both `@narduk-enterprises` and
`@narduk-geo`.

`narduk-app assets favicons` creates ordinary browser favicon files only. It
does not create a web manifest, service worker, install UI, or PWA icon set.

## Web foundation conformance

`narduk-app foundation:check [--checkout <dir>] [--json [path]]` evaluates the
seven web-cf foundation items ratified by D-WEBFOUND-2 Q9 (a) (company-hq
`strategy/web-foundation-libs-plan.md#4`) against the whole checkout. Every item
resolves to `pass`, `fail`, `unknown`, or `not-applicable` -- there is no
warning tier, and `unknown` is never a pass. Exit code `0` is PASS, `1` is FAIL,
`2` is UNKNOWN (an app's own CI should treat that as a failure too). The
`--json [path]` artefact is `schemaVersion: 1`,
`tool: '@narduk-enterprises/narduk-app-tools'`, and is the exact shape
company-hq's `scripts/check-web-foundation.py` `validate_artefact()` consumes
for the weekly fleet rollup.

### Shared UI pinned (`foundation:check:shared-ui-pinned`)

`narduk-app foundation:check:shared-ui-pinned [--checkout <dir>] [--json [path]]`
-- components-library-plan.md §2 item 6
([narduk-libs#253](https://github.com/narduk-enterprises/narduk-libs/issues/253)).
The evaluator is `src/foundation/items/item-8-shared-ui-pinned.ts` and matches
items 1-7 (`check()` sub-checks, no warn tier). It is a separate command and
JSON artefact (`tool: '@narduk-enterprises/narduk-app-tools/shared-ui-pinned'`)
because `foundation:check --json` is the exact 7-item contract company-hq
`check-web-foundation.py` validates; an `id` outside `1..7` is a rollup-red F3
ARTEFACT finding. Same exit-code convention as `foundation:check` (`0` PASS, `1`
FAIL, `2` UNKNOWN).

**Presence policy:** this command enforces exactly one rule, decided from the
app's own manifests: _if the app depends on a shared-UI package, that pin must
be exact_. It deliberately does **not** require an app to take a dependency it
does not use -- an unused shared-UI package is `not-applicable`, not a finding.
An earlier revision registry-gated presence ("narduk-charts is published,
therefore every UI app must depend on it"), which conflated _published_ with
_required_: narduk-charts is a charting library and narduk-ui is the `Ns*`
status instruments, so neither is mandatory on an app that needs neither. The
exported `PRESENCE_REQUIRED` is the one place a genuine estate-wide requirement
would be recorded; it is empty because no dated decision names a shared-UI
package as required of every UI app, and a test pins it empty so an addition
cannot land silently.

**No registry credential is needed.** Exact-pin discipline is a manifest fact,
so this item never needs a registry read to reach a verdict and a missing
`NODE_AUTH_TOKEN` can no longer turn the command into exit `2`; `unknown` now
means only "no `package.json` at a known monorepo path". `RegistryReality` is
still consulted, but only to annotate an already-decided sub-check with the
latest published version -- an unreadable registry drops the annotation and
changes no status. That is what lets the generated CI run this check after its
install step has dropped the GitHub Packages token
(`foundation:shared-ui-pinned` in the generated `quality:static` chain).

"Has UI" reuses `hasNuxtUiSurface()` -- item 1.1's `NUXT_CONFIG_CANDIDATES` plus
a pages or components directory at those same monorepo prefixes (the paths item
3 / Wave-1 already walk). A `nuxt` dependency alone does not count. API-only
apps are `not-applicable` in full.

**Rule table:**

| Sub-check       | Condition                                                                                 | Verdict                                                                           |
| --------------- | ----------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| 8.0             | No `package.json` readable at a known monorepo-candidate path                             | `unknown`                                                                         |
| 8.0             | No `nuxt.config.*` at a known path, or no pages/components directory at the same prefixes | `not-applicable` (whole check)                                                    |
| 8.0             | Nuxt config and a pages/components directory exist                                        | `pass`                                                                            |
| 8.1 / 8.2 / 8.3 | not a dependency of this app, and not listed in `PRESENCE_REQUIRED`                       | `not-applicable` -- capability-specific, so its absence is not a finding          |
| 8.1 / 8.2 / 8.3 | not a dependency, but listed in `PRESENCE_REQUIRED` (today: none are)                     | `fail` -- "required of every UI app and is not a dependency"                      |
| 8.1 / 8.2 / 8.3 | depended on, but the pin is a range or a `workspace:` / `file:` specifier                 | `fail`, names the package and the fix                                             |
| 8.1 / 8.2 / 8.3 | depended on and pinned to an exact version (`1.2.3` or `1.2.3-alpha.1`)                   | `pass`, annotated with the latest published version when the registry is readable |
