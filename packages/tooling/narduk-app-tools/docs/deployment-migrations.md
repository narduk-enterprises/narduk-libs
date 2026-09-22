# D1 deployment migrations

`narduk-v1` applies reviewed, backward-compatible migrations automatically after
successful CI and before production promotion. Workers Builds uploads versions;
it does not migrate databases. The app owns its workflows and source manifests.
The generator supplies one-shot onboarding templates under `docs/deployment/`.
Installing a package alone does not activate these workflows in existing apps.

This closes the missing integration between the existing checksum/adoption
migration runner and `versions-promote` (narduk-libs#578). The legacy
`cf:deploy` script's migration step never ran on the standard `versions-upload`
path.

## Declare every database

Add this to `Config/cloudflare-app.json`'s existing `deployment` block:

```json
{
  "migrations": {
    "compatibility": "expand-contract",
    "credential": "cloudflare/prd/example-migrate",
    "databases": [
      { "binding": "DB", "sources": "apps/web/migrations.sources.json" }
    ]
  }
}
```

`worker.wranglerConfig` identifies the production Wrangler JSON/JSONC file and
`product.repository` identifies the repository. An explicit account ID must be
present in that config or `deployment.accountId`; conflicting IDs are refused.
Each D1 binding needs exactly one source manifest, including separate auth and
read-model databases. Use immutable numbered SQL files and stable source names.
Dependencies supply their migrations before app migrations. A managed/rebuilt
read model needs its own schema ownership and migration/adoption plan; do not
point its binding at the auth database's manifest merely to satisfy coverage.

## Declare who owns each schema (`databaseOwnership`)

Coverage demands that every D1 binding have exactly one schema owner. For a
database whose schema _is_ its migration history, that owner is
`deployment.migrations`. For a database whose schema is owned by something else
-- a JSON contract applied by a refresh job, say -- there is nothing honest to
put in `deployment.migrations`, and manufacturing a baseline for it is the worst
available answer: it claims the migration ledger describes a schema it does not
describe, and the next reader believes it.

So an app with a mixed estate declares ownership explicitly:

```json
{
  "migrations": {
    "compatibility": "expand-contract",
    "credential": "cloudflare/prd/example-migrate",
    "databases": [
      { "binding": "DB", "sources": "apps/web/migrations.sources.json" }
    ]
  },
  "databaseOwnership": [
    { "binding": "DB", "owner": "migrations" },
    {
      "binding": "READ_MODEL",
      "owner": "contract",
      "contract": "apps/web/read-model/contract.json",
      "verify": "pnpm run read-model:check"
    }
  ]
}
```

- **Optional, and absent means what it always meant.** An app that migrates
  every binding declares no `databaseOwnership` and changes nothing.
- **Once declared it is the complete statement.** Every D1 binding the app binds
  gets exactly one entry; a binding named here that the app does not bind, or a
  bound binding named nowhere, is refused.
- **`owner: "migrations"`** resolves to an entry in
  `deployment.migrations.databases`; it does not repeat the sources path.
- **`owner: "contract"`** names the schema contract file and the command that
  proves the live database matches it. Both must exist -- the contract as a file
  in the checkout, the command as a script in the app's or the workspace root's
  `package.json` -- because a declaration pointing at neither reads in review as
  proof of a check that would never have run. That is why `verify` must be a
  package-script invocation (`pnpm run <script>`): a free-form shell string
  cannot be checked by a repository read.

### The migration runner refuses a contract-owned database

This is enforced at the runner, not only at the schema. `migrationDatabase()` is
the one function every migration path uses to reach D1, and it refuses a
contract-owned binding before any provider call:

```
$ narduk-app db migrate --database READ_MODEL --config ... --remote
Refusing to run migrations against READ_MODEL: deployment.databaseOwnership
declares it contract-owned by apps/web/read-model/contract.json. Prove it with
`pnpm run read-model:check` instead; the migration runner must never write to a
contract-owned database.
```

`db migrate`, `db status`, `db migrate-deployment`, baseline capture and
baseline registration are all covered, and so is a wrangler config that points a
different binding name at the contract-owned database id. A contract-owned
database is additionally absent from the minimal wrangler config
`db migrate-deployment` hands the runner, so no binding name in that config can
select it. An ownership declaration that cannot be parsed is a refusal rather
than an assumed absence: a runner must not guess who owns a schema.

`foundation:check:deployment` sub-check 12.8 applies the same coverage rule, and
`doctor --adoption` requirement 6 reads that sub-check, so the gate and the
runner cannot disagree.

For preview and optional staging, the command uses the **same binding planner**
as `versions-upload`. Declare concrete, separate IDs and names for every D1, KV
and R2 binding in `deployment.previewBindings` or `deployment.staging.bindings`.
Production resources, missing replacements and placeholders are refused.
`preview_database_id` is a local-development setting, not a deployed preview. No
per-PR database creation or cleanup is performed.

The command writes a temporary minimal Wrangler config with just the account and
D1 bindings and passes `--config` on every operation. Build-output redirects,
ambient environment selection and Worker configuration cannot select a different
D1. An explicit scoped `CLOUDFLARE_API_TOKEN` is required; no ambient OAuth
fallback.

## Production ordering and credentials

The app's promote workflow must follow these steps in one serialized job:

1. Require a successful same-repository CI `workflow_run` for the production
   branch. Check out **`workflow_run.head_sha`** and install its frozen
   toolchain.
2. With no credential, run
   `narduk-app foundation:check:deployment --json <path>` on that checkout and
   refuse unless sub-check **12.9** is `pass`. That means no app-owned migration
   drops or renames anything except a declared, checksum-pinned contract
   migration (see below). Judge 12.9 alone. Another sub-check's UNKNOWN, such as
   12.4's live preview read, is not a reason to refuse a migration. Generated
   apps do not run this check in CI, so the promote job must run it itself on
   the exact SHA it migrates.
3. With the existing promote credential, run
   `narduk-app deploy versions-promote --sha "$VERIFIED_SHA" --production-branch main --dry-run --json`.
   A missing upload or stale version fails before changing the database.
4. Inject the **separate D1-only migrate persona** for this step only, then run:
   ```sh
   narduk-app db migrate-deployment --target production --sha "$VERIFIED_SHA"
   narduk-app db migrate-deployment --target production --check
   ```
5. Only on success, restore the separate promote credential, promote that exact
   SHA, then perform live proof. Keep the app's existing alert and Worker
   rollback handling. Rollback requires a completed promotion followed by failed
   live proof; a migration failure must not trigger a Worker rollback.
6. Upload `.narduk/recovery/d1` with `if: always()`, hidden files included and
   restricted artifact access. It contains schema/ledger metadata and a Time
   Travel bookmark, not application records or credentials. Missing evidence on
   a no-op run is normal; a pending migration requires successful capture.

**Automated rollback depends on step 2 (narduk-libs#399).**
`narduk-app deploy rollback` restores code, never a schema. A promote workflow
(slice W1) may run rollback automatically after failed live proof only when step
2 runs before its migrate step. The same holds for an app wiring rollback into
its own promote job, such as Buoys slice B3. Without step 2, rollback stays a
manual command, run by someone who knows what the schema did.

`create-narduk-app` emits `promote-d1.steps.yml` for this insertion, step 2
included. Keep workflow concurrency `cancel-in-progress: false`. Repository
concurrency reduces overlap; the database lock below supplies cross-repository
serialization. Multiple configured databases migrate sequentially after all have
passed preflight. They are **not** one transaction: failure on database B can
leave A advanced.

Register one per-app, per-purpose migrate persona through the workstation's
canonical provisioner and nVault route, and issue its consumer a config-scoped
service token. A pre-materialized `D1_MIGRATE_API_TOKEN` environment secret may
carry that persona into the supplied templates; an existing app's nVault adapter
may inject the same process-scoped variable instead. Runners consume
credentials; they never receive provisioners or mint tokens. The persona needs
D1 Read/Write on the target account only, with no Worker Scripts, DNS, R2 or
account-admin grants. Do not widen the promote persona. Mint/rotate only
same-or-narrower grants under D-MINT-1; any genuinely broader request remains a
separate scope decision.

Cloudflare D1 permissions are **account-scoped**, not database-scoped.
Per-purpose naming does not reduce that provider blast radius. Trusted tooling,
exact target validation, protected production branches and step-scoped injection
are therefore part of the boundary. Use a D1 Read-only persona for independent
drift audits.

## Shared PR preview databases

The chosen first version uses the existing declared preview databases:

1. Add the generated `ci-d1-bundle.job.yml` job to ordinary CI and include it in
   the required result. It checks out the same-repository PR head and emits
   `d1-migrations.json` using `narduk-app db bundle --output <file>`. It
   receives package-read access only, **never D1 or deployment credentials**.
   Forks do not enter the credentialed migration path. The bundle artifact is
   attempt-specific.
2. Activate the generated `preview-d1.yml` workflow. After successful CI, it
   checks out the trusted default branch, installs that frozen toolchain, and
   downloads the artifact from the exact triggering run ID and attempt.
3. With the D1-only persona injected for one step, trusted tooling parses the
   strict SQL/data schema, verifies repository/SHA/checksums, materializes its
   own safe paths, and applies to the **trusted default branch's preview IDs**:
   ```sh
   narduk-app db migrate-deployment --target preview --sha "$VERIFIED_SHA" --bundle "$SQL_BUNDLE"
   narduk-app db migrate-deployment --target preview --sha "$VERIFIED_SHA" --bundle "$SQL_BUNDLE" --check
   ```
4. Run preview health/smoke checks only after success. A version URL uploaded by
   Workers Builds is not a schema-readiness signal. The template does not hide
   an already uploaded version URL; the app's preview acceptance gate must
   depend on this job's successful result.

Never execute PR scripts, install PR dependencies, or resolve Wrangler from a PR
checkout in the credentialed job. Bundles contain SQL and adoption metadata
only; no executable file or path supplied by an artifact is used. SQL cannot
change the selected account/database. References to the runner's ledger/lock are
refused. A digest verifies integrity, not provenance; the exact-run artifact
download and trusted workflow are the provenance boundary.

Shared previews must remain compatible with other active previews. A branch
whose applied history is absent, changed or out of order fails. Rebase onto the
shared migration history or repair the preview through its owner; never erase
ledger rows or reset a shared database to make a conflicting PR pass. Empty SQL
sources are supported. Preview topology/source ownership changes must land in
the trusted default branch before a PR can use them.

## Drift gate and compatibility

`narduk-app db status --config migrations.sources.json --database DB --remote --wrangler-config wrangler.jsonc`
is the lower-level read-only equivalent. The standard commands use the target
manifest automatically:

```sh
narduk-app db migrate-deployment --target production --check
narduk-app db migrate-deployment --target preview --check
```

Status exits 0 for exact current history, 2 for pending SQL or adoption, and
nonzero for errors, unknown/changed remote rows, missing sources, out-of-order
history, malformed provider responses or an active/retained lock. It performs
only SELECT/PRAGMA reads: it creates no ledger, lock or recovery snapshot. A
successful result is a point-in-time history/checksum observation. It does not
prove absence of manual schema/data edits that bypassed the ledger.

Foundation item **12.8** requires every declared D1 binding to have a source
manifest and a distinct migrate credential declaration. No-D1 apps are
not-applicable. It reads the repository only and says explicitly that remote
parity needs the command above. It cannot prove token scope or that an app has
actually activated its workflow; keep those onboarding proof items open.

Automatic migrations must work with the Worker **currently serving traffic** and
all versions still eligible for rollback. Review expand/contract explicitly: add
nullable/defaulted structures, backfill compatibly, deploy code that tolerates
both shapes, then remove old structures only in a later reviewed change once old
readers/writers and the rollback window are retired. SQL checksums cannot prove
this property. The `expand-contract` declaration is a review contract, not a
static proof of SQL or application compatibility.

Foundation sub-check **12.9** holds the mechanical half of that contract: an
app-owned migration that drops or renames a table, view or column fails unless
it is declared a reviewed contract migration, pinned by the checksum the ledger
records:

```json
"migrations": {
  "compatibility": "expand-contract",
  "credential": "cloudflare/prd/<app>-migrate",
  "databases": [{ "binding": "DB", "sources": "apps/web/migrations.sources.json" }],
  "contractMigrations": [
    {
      "path": "apps/web/migrations/0007_drop_legacy_flag.sql",
      "sha256": "<the sha256 12.9 prints>",
      "reason": "legacy_flag was last read by the version that left the rollback window on 2026-09-01"
    }
  ]
}
```

The waiver says the file is safe _now_: no version still serving or eligible for
rollback reads what it removes. It covers those bytes only. A migration history
that already contains a contract migration adopts the rule by listing it once.
12.9 does not read package-owned sources, and it cannot see a data rewrite or a
new constraint the previous code violates; review still owns those.

## Lock, failure and recovery

`_narduk_migration_lock` contains a singleton row with a unique owner and
timestamp. An atomic insert admits one cooperating runner per actual database,
independent of repository, runner host or binding alias. A successful run
releases only its own row. It checks history again under the lock before
writing. Retire old scripts/direct Wrangler writers before claiming all writers
serialize; this library cannot stop unrelated credentials executing arbitrary
SQL.

Remote errors, client timeout or cancellation **retain the lock**. There is no
TTL/automatic lock stealing: a disconnected client does not prove that the
provider stopped the import. Promotion fails. The currently serving Worker
continues against whatever compatible schema steps completed. Each SQL file and
its checksum ledger insert are submitted together through D1's file import;
there is no transaction spanning the complete migration sequence or all
databases. A Worker rollback never reverses any schema/data change.

Recovery is an operator action, not an automatic retry:

1. Identify the database ID, account, retained owner and previous job. Confirm
   the old runner and any remote import have ended. Preserve logs and the
   pre-migration recovery artifact before doing anything else.
2. Read schema and ledgers with the read persona. Reconcile the actual result,
   especially after a lost response. Do not replay from an assumption of
   failure.
3. Prefer a reviewed forward correction that remains compatible. A database
   restore is a separate incident decision: it can discard later writes, affects
   every consumer of that database, and is not part of Worker rollback.
4. After investigation, clear **only the verified owner** using an explicitly
   selected account/database and D1 credential:
   `DELETE FROM _narduk_migration_lock WHERE id = 1 AND owner = '<verified owner>';`
   Never blindly clear another run's row. Then rerun status and the gated
   workflow.

Existing native `d1_migrations` and legacy `_applied_migrations` histories
require explicit reviewed adoption mappings and schema evidence; the runner does
not infer a baseline or replay SQL just because its own ledger is absent.
Read-model rebuilds or inline schema initializers with no ledger are
**unverified**, not current. The runner refuses existing application tables with
empty or absent migration histories, even when the manifest contains no SQL. Use
the shared [reviewed baseline process](migration-baselines.md) to capture,
review, prove and register the schema without replaying historical SQL. The app
owns the review and schema; the shared commands supply the procedure. An empty
manifest is not an exemption. Provider-internal `_cf_*` and SQLite tables do not
count as application schema. Applied SQL is immutable; append a correction
instead of editing it.

Provider references:
[D1 migrations](https://developers.cloudflare.com/d1/reference/migrations/) and
[D1 SQL import](https://developers.cloudflare.com/d1/best-practices/import-export-data/).
