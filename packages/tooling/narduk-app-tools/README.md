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
Checks that a UI app pins `@narduk-enterprises/narduk-shell`,
`@narduk-enterprises/narduk-ui`, and `@narduk-enterprises/narduk-charts` exactly
wherever it depends on them, so a fleet-wide bump lands as one Dependabot PR per
app instead of drifting one package at a time. Same status vocabulary and
no-warning-tier rule as `foundation:check`, same exit-code convention (`0` PASS,
`1` FAIL, `2` UNKNOWN).

**This is a separate command and a separate JSON artefact from
`foundation:check`, not an eighth item folded into its seven-item contract.**
`foundation:check`'s artefact is fixed: `FOUNDATION_ITEM_COUNT` is `7`,
`buildArtefact()` throws if an item set is any other shape, and company-hq's
`check-web-foundation.py` -- the weekly fleet rollup that consumes
`foundation:check --json` artefacts from every app -- hard-codes the same seven
items and rejects (as a RED, exit-1 `F3 ARTEFACT` finding) any artefact item
whose `id` falls outside `1..7`. Neither is narduk-libs's to unilaterally widen:
doing so here would break every other app's rollup the moment it upgraded this
package. `foundation:check:shared-ui-pinned` therefore ships its own
`schemaVersion: 1` artefact
(`tool: '@narduk-enterprises/narduk-app-tools/shared-ui-pinned'`, one `item`
instead of an `items` array) that nothing mistakes for the ratified contract.
Folding this check into `foundation:check` as item 8 is a follow-up that needs
its own company-hq decision and a matching `check-web-foundation.py` change, not
a change made in this package alone.

**Rule table:**

| Sub-check | Condition                                                                                                                                                    | Verdict                                                                                                                                                  |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 8.0       | No `package.json` readable at any known monorepo-candidate path                                                                                              | `unknown`                                                                                                                                                |
| 8.0       | App has no UI signal (no `nuxt` dependency and no `nuxt.config.*` file at any of the same candidate paths `foundation:check` item 1.1 uses)                  | `not-applicable` (whole check)                                                                                                                           |
| 8.1       | `@narduk-enterprises/narduk-shell`'s registry publication status cannot be resolved from here (no credential, network error, or genuinely not yet published) | `unknown`                                                                                                                                                |
| 8.1       | narduk-shell is published on the registry but this UI app does not depend on it                                                                              | `fail`, names the package                                                                                                                                |
| 8.1       | narduk-shell is published and depended on, but the pin is a range or a `workspace:` specifier                                                                | `fail`, names the package and the fix                                                                                                                    |
| 8.1       | narduk-shell is published and pinned to an exact version                                                                                                     | `pass`                                                                                                                                                   |
| 8.2 / 8.3 | narduk-ui / narduk-charts is not a dependency                                                                                                                | `not-applicable` -- presence is never required; the later adoption items (status apps take narduk-ui, dashboards take narduk-charts) decide who needs it |
| 8.2 / 8.3 | narduk-ui / narduk-charts is a dependency, pinned to a range or `workspace:`                                                                                 | `fail`, names the package and the fix                                                                                                                    |
| 8.2 / 8.3 | narduk-ui / narduk-charts is a dependency, pinned to an exact version                                                                                        | `pass`                                                                                                                                                   |

"Has UI" reuses the exact `nuxt.config.*` candidate list `foundation:check` item
1.1 already resolves the real Nitro preset from (`nuxt.config.ts`, `.mts`,
`.mjs`, `.js`, and the `apps/web/`/`web/` monorepo variants), plus a direct
`nuxt` dependency -- no existing item exposes a single "app kind" boolean, so
this is the closest existing precedent rather than a new heuristic.

narduk-shell's requirement is gated on a live registry read
(`RegistryReality.latestPublishedMajor`, the same abstraction `foundation:check`
item 2.3 uses for narduk-core's N-1 window) rather than a hard-coded flag,
because this check ships inside the published `narduk-app-tools` package and
runs in a _consumer_ app's CI -- it cannot see narduk-libs's own tree to know
whether `packages/design/narduk-shell` has shipped yet. Until a registry read
resolves a published major for narduk-shell, its presence is reported `unknown`
rather than guessed as `fail`; this automatically becomes `fail` once
narduk-shell publishes and an app is missing it or has it on a loose pin, with
no further code change needed here.
