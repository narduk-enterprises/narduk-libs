# Reviewed D1 baselines and cutover proof

Use this process when adopting an existing database. A baseline is a reviewed
statement of its schema at a fixed cutover point. It is not evidence that
unknown historical SQL, seed data or backfills ran. The application owns the
schema and review; `narduk-app db baseline` owns capture, comparison,
registration and the reusable local proof. Do not invent an
`_applied_migrations` row to bypass the untracked-schema refusal.

## Choose the existing-history or untracked path

- **Stable `_narduk_migrations` history:** preserve it. Capture a cutover
  artifact and use `prove` against new package/app migrations. No baseline
  registration.
- **Native `d1_migrations` or legacy `_applied_migrations`:** preserve the rows
  and use explicit adoption mappings with checksums, versions and schema probes.
  Capture the pre-adoption fixture if testing that transition. A package version
  change does not excuse unresolved adoption evidence. After successful
  adoption, capture a second immutable artifact with the stable receipts for
  future proofs.
- **Application schema and no recorded history:** give that database its own
  app-owned source and initial schema migration using the process below. Do not
  claim old core/auth migrations ran based on matching table names. In
  particular, an auth manifest does not own a separate read-model database.

An already managed auth database with pending package migrations stays on the
ordinary migration path. Baseline registration is not a way to skip those files.

## 1. Capture the cutover with the read persona

Stop competing schema writers, including inline schema initializers, for the
capture/review/registration window. Normal application writes may continue only
if they do not change schema. Inspect the binding before using an explicit
production/staging Wrangler JSON or JSONC file; environment flags and generated
build redirects are deliberately unsupported here.

```sh
mkdir -p migrations/cutovers migrations/read-model
pnpm exec narduk-app db baseline capture \
  --database READ_MODEL --wrangler-config apps/web/wrangler.jsonc --remote \
  --revision <40-character-reviewed-source-commit> \
  --output migrations/cutovers/read-model-v1.json
```

For an existing local database, replace `--remote` with `--local` and pass
`--persist-to <existing-local-state-directory>` explicitly. The proof command
manages its own disposable state and accepts neither target flag.

Inject the registered D1 Read persona as `CLOUDFLARE_API_TOKEN` for remote
capture and check. Capture performs only schema/ledger reads, checks the
migration lock and compares two observations to detect metadata movement. It
creates no ledger, lock or recovery artifact on the database. The JSON records:

- format version, capture time, repository revision and origin account/database;
- full table, index, view and trigger DDL, excluding provider/runner metadata;
- existing stable checksums/source versions and legacy filename records;
- a SHA-256 digest over that fixed payload.

No application rows are copied. DDL can contain sensitive defaults; review and
store the artifact with the appropriate repository access. Virtual-table schemas
are refused by this first version rather than guessed. The digest detects edits;
it does not authenticate a reviewer or prove an historical data transformation.
Outputs never overwrite existing files. Preserve the original artifact forever;
do not regenerate it from a newer package to make a later test pass.

## 2. Establish the untracked schema's owner and review artifact

For an untracked read model, emit its initial migration from the captured DDL:

```sh
pnpm exec narduk-app db baseline sql \
  --artifact migrations/cutovers/read-model-v1.json \
  --output migrations/read-model/0000_baseline.sql
```

Create a dedicated source manifest (paths resolve relative to that manifest):

```json
{
  "schemaVersion": 1,
  "sources": [
    { "source": "app:read-model", "path": "read-model", "sourceVersion": "1" }
  ]
}
```

For this example save it as `migrations/read-model.sources.json`, and map only
READ_MODEL to that manifest in `deployment.migrations.databases`. The
registration path requires one app-owned source and the matching baseline as its
first SQL file. It cannot register inferred package histories. On a genuinely
empty new D1, the ordinary runner executes this initial schema migration. On an
existing matching D1, registration records it without executing its DDL.

The app's review PR must contain the immutable artifact, initial SQL, manifest,
source ownership, cutover revision, exact target identities, and the proof
output. Review complete DDL and semantics, not counts or object names. Document
any required data invariants/backfills separately: schema-only proof cannot
establish them. Resolve conflicting initializers and name the one schema writer.
Agree on recovery before the one-time registration. Do not edit the generated
baseline SQL; resolve an incorrect capture in a new reviewed artifact before
registration.

## 3. Compare every target, prove locally, then register

Production and staging may share the same reviewed schema artifact **only when
each passes the full schema and ledger comparison**. Its origin identifies where
it was captured, not an authorization to write another database.

```sh
pnpm exec narduk-app db baseline check \
  --artifact migrations/cutovers/read-model-v1.json \
  --database READ_MODEL --wrangler-config apps/web/wrangler.jsonc --remote
pnpm --dir apps/web exec narduk-app db baseline prove \
  --artifact ../../migrations/cutovers/read-model-v1.json \
  --config ../../migrations/read-model.sources.json \
  --source app:read-model --filename 0000_baseline.sql
```

`prove` resolves Wrangler from the invoking workspace; the example uses
`apps/web`, where a generated app installs Wrangler. It creates disposable
**local D1** state, recreates the captured schema and ledger, then runs the
currently pinned migration sources. It uses an isolated Wrangler config/state
directory and deletes only that temporary directory. No remote flag is accepted.
An untracked snapshot uses only the named initial baseline receipt in the
fixture. A tracked snapshot uses its recorded history; no
`--source`/`--filename` is needed. Add this command to app CI for subsequent
package upgrades and local migrations. Keep a separate ordinary empty-database
migration test, and add data-bearing synthetic fixtures when transformations
need data proof. This shared command proves schema transitions, not data safety.

After the review PR is merged and target checks pass, use the separate D1-only
migrate persona for the one-time metadata registration:

```sh
pnpm exec narduk-app db baseline register \
  --artifact migrations/cutovers/read-model-v1.json \
  --config migrations/read-model.sources.json \
  --source app:read-model --filename 0000_baseline.sql \
  --database READ_MODEL --wrangler-config apps/web/wrangler.jsonc --remote \
  --expect-database-id <reviewed-target-uuid> \
  --expect-digest <reviewed-artifact-sha256> \
  --review-ref https://github.com/example/app/pull/123
```

The explicit digest, target UUID and review URL make the operator's reviewed
selection inspectable; the CLI does not independently certify GitHub approval.
It checks the artifact and SQL, compares the live schema and empty history,
acquires the same database lock as migrations, compares again, and captures a
remote recovery bookmark/schema. It writes only the stable baseline receipt and
`_narduk_migration_baselines` audit receipt, together in one D1 file
transaction. It does **not** run baseline DDL, seed data or later migrations. A
failure retains the remote lock and recovery evidence under the normal recovery
policy. Do not blindly retry a lost response: inspect the receipt and retained
owner. A second registration refuses the now-recorded history; use ordinary
status.

Run the normal read-only migration status afterward. Later SQL should still be
pending; reviewed compatible changes then run through the migration-before-
promotion workflow. Repeat check/registration with each separately reviewed
staging or production target. This process does not enable an app's previews.

## Later package upgrades and destructive changes

The frozen fixture never changes merely because a new package ships. Suppose it
records core v1's `0001.sql`, and core v2 adds `0002.sql` dropping an obsolete
table. `prove` recreates the **captured cutover schema**, preserves the old
checksum receipt, and applies only `0002.sql`. It does not seed by replaying all
v2 files. The same logic applies to app-owned migrations; file location is
irrelevant.

Legacy table/column/index probes are required when adopting an unresolved row.
Once its stable checksum receipt exists, future migrations can legitimately
change those objects. The runner still checks immutable SQL checksums, missing
history and unmapped legacy rows; it does not re-require the old schema or the
old installed package version after adoption has been recorded.

A passing baseline proof does not authorize a destructive migration. Package
maintainers must publish compatibility/release notes and preserve the serving
and rollback versions during expand/contract. Consumers control their exact
package pins, review new SQL before upgrading, and prove compatibility with
their old and candidate Workers. A new upstream migration does not automatically
arrive in all pinned consumers at once. Worker rollback still never restores D1.
