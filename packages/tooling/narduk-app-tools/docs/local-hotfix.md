# Local break-glass hotfix

`narduk-app deploy-hotfix` ships a committed patch from a trusted workstation
when waiting for the normal Cloudflare build / GitHub promotion path would
prolong an incident. It does not need a push, a PR, GitHub availability, or a
Workers Builds run. It does need Cloudflare's Workers API and an already
registered recovery credential. The ordinary deployment path remains the
default.

## When to use it

The incident commander (Logan, or the person he designates for that incident)
may authorize a local hotfix for an active production outage, a serious broken
customer flow, or an urgent security mitigation when the normal delivery path is
unavailable or too slow for the ongoing harm. Record the incident ID, impact,
why normal delivery is unsuitable, operator, approver, and intended patch. If
GitHub is down, use an offline incident note and file it when service returns.
Authorization is for that patch and target, not a standing CI bypass.
<!-- enforcement: none yet; incident authorization and severity are human decisions -->

Use a minimal application code or asset patch against the production source. Do
not use this path for routine feature work, failing correctness/security checks,
destructive changes, schema migrations, credential rotation, new bindings,
routing/DNS changes, or a first deployment. Those changes need their own
reviewed procedure. A known-safe provider rollback or feature disable may stop
the harm faster; choose it when appropriate.
<!-- enforcement: none yet; patch scope and rollback suitability require operator review -->

The command requires a clean full HEAD, an explicit Worker name, an incident,
reason and operator, a valid `narduk-v1` deployment block, an account match,
passing local checks/build, and a single currently deployed version at 100%.
There are no skip-check, skip-proof, force-dirty, Wrangler passthrough, or
migration flags. `--yes` confirms execution; it is not proof of human approval.
<!-- enforcement: named; mechanism: planHotfix and runHotfix with deploy-hotfix.test.ts; runs at: each deploy-hotfix invocation and package tests; rejects: missing attestations target mismatches dirty source CI callers missing gates and failed proof -->

## Prepare each app before an incident

1. Adopt the released `@narduk-enterprises/narduk-app-tools` version containing
   `deploy-hotfix` and commit the lockfile. Existing app versions do not gain
   this command merely because the library source changed. New generator
   versions provide these scripts; existing apps add the equivalents at the
   **repository root**:

   ```json
   {
     "scripts": {
       "hotfix:check": "pnpm run format:check && pnpm run lint && pnpm run typecheck && pnpm run test:unit",
       "hotfix:build": "pnpm --filter web run cf:build",
       "deploy:hotfix": "pnpm --filter web exec narduk-app deploy-hotfix"
     }
   }
   ```

   Add a production `hotfix:build`; never point it at `build:ci`, which embeds
   committed test-only signing/session secrets. The example is for a minimal
   app. Include its manifest, foundation and security checks in `hotfix:check`.
   Generated apps include these additional gates. Both scripts must be local,
   deterministic checks/builds with no deploy or remote data writes. Checks
   receive no secrets; the production build receives only its two named app
   secrets. The CLI enforces script presence and exit status, not script
   contents. A Wrangler `build.command` hook is refused: move that work into
   `hotfix:build` so upload cannot rebuild after validation with the deploy
   token.
   <!-- enforcement: none yet; app owners review script contents and test coverage -->

2. Commit the production account ID in `deployment.accountId` in
   `Config/cloudflare-app.json` or `account_id` in Wrangler. The manifest's
   `worker.name`, Wrangler's name, and `--confirm-worker` must agree. Keep
   `deployment.liveProof` health and smoke paths accurate; the smoke route is
   expected to return HTML. The normal `narduk-core` build-version header must
   identify the build. The chosen HTTPS origin is operator-confirmed; the CLI
   cannot prove that DNS/routes bind that origin to this Worker.
   <!-- enforcement: named; mechanism: planHotfix and verify-live; runs at: preflight and post-promotion proof; rejects: inconsistent account or Worker identities missing deployment contract and mismatched build header -->

3. Resolve the app's approved credential route ahead of time:

   ```sh
   provider-credential resolve-operation \
     --repository OWNER/REPO --operation cloudflare-worker-deploy
   ```

   Separately identify the app’s registered production **build** secret selector
   for `NUXT_OG_IMAGE_SECRET` and `NUXT_SESSION_PASSWORD`. Inject the same
   stable values used by normal production builds, using a nested scoped
   `nvault run` if the app build and Cloudflare credentials have different
   selectors. Do not fetch runtime Worker secret values or create replacement
   values during a hotfix.

   Use only the returned registered nVault selector. The credential must support
   version/deployment reads, version upload (including asset upload), and
   promotion for the intended account/Worker. A promotion-only credential may
   lack upload permissions. If the route is missing, have the credential owner
   register and prove it before the incident; do not guess a selector, reuse a
   broad token, or read retired Doppler `narduk/*` sources. The CLI consumes
   `CLOUDFLARE_API_TOKEN` and validates the account; it does not authenticate
   the operator or verify token provenance/least privilege.
   <!-- enforcement: none yet; credential registration and persona review are outside this CLI -->

4. Warm the package store with the app's pinned Node/pnpm versions:

   ```sh
   gh-packages-run pnpm install --frozen-lockfile
   ```

   Keep required pnpm-store entries, the toolchain and the CLI available on the
   recovery machine. Each real hotfix performs an **offline frozen install** in
   a temporary local clone; a missing package fails before upload. Build scripts
   may still need external resources: remove that dependency or document it in
   the app's recovery readiness drill. No offline success is claimed for them.

5. Identify every production writer: promotion workflows, queued/in-progress
   jobs, direct deployments, other operators, and bots. Record how to stop them
   and how to restore their prior state. Rehearse a dry-run and a disposable
   non-production Worker deployment after adoption, including failed proof and
   recovery. A dry-run alone does not prove credentials, cache readiness, build,
   upload, or runtime behavior.
   <!-- enforcement: none yet; preparedness and a non-production drill are operator obligations -->

## Incident procedure

1. Record approval and take exclusive ownership of production. Pause automatic
   promotion, cancel queued/in-progress promotion jobs, and have other operators
   stop deployments. Where GitHub is available, an app with `promote.yml` can
   use `gh workflow disable promote.yml --repo OWNER/REPO`; disabling does not
   cancel existing runs, so inspect and cancel those separately. Use the actual
   app workflow names. If GitHub cannot be reached, use the prearranged
   deployment hold/credential custody procedure. Do not assert a hold you cannot
   establish. Leave builds that only upload harmlessly queued if useful; any
   direct-deploy trigger must also be held.
   <!-- enforcement: none yet; --automation-paused records an operator assertion and does not pause CI -->

2. Start a dedicated clean checkout/branch from the commit serving production,
   apply only the fix, review the diff, add a regression test, and commit. A
   local-only commit is allowed. Do not blindly deploy the latest main if it
   contains unrelated unreleased work. Complete the targeted incident tests and
   review compatibility with the live database and the previous Worker version.
   <!-- enforcement: none yet; choosing the production baseline and reviewing patch scope are manual -->

3. From the repository root, inspect the offline plan (replace the sample IDs,
   reason, operator, Worker and URL with the incident's actual values):

   ```sh
   HOTFIX_SHA=$(git rev-parse HEAD)
   pnpm run deploy:hotfix \
     --incident INC-123 --reason 'Workers Builds unavailable during checkout outage' \
     --operator 'Incident operator' --sha "$HOTFIX_SHA" \
     --confirm-worker example --base-url https://example.com --dry-run
   ```

   `--dry-run` checks local source/configuration and prints the sequence. It
   performs no credential reads, provider calls, installs, builds, receipt
   writes, or production changes.

4. Execute under the **registered selector returned in preparation**. The
   resolver returns the credential ID and its key names as well as the selector.
   Registered personas often use purpose-prefixed keys, not
   `CLOUDFLARE_API_TOKEN`. Use the installed persona wrapper to verify that
   credential and map its named keys into the CLI's process environment. Never
   put a token value in an `env` argument or copy it into a dotfile. Values
   below are metadata placeholders, not a new credential naming convention:

   ```sh
   nvault run -p APP_PROJECT -e APP_ENV -c REGISTERED_BUILD_CONFIG -- \
     nvault run -p PROJECT -e ENVIRONMENT -c REGISTERED_CONFIG -- \
     ~/.local/share/agent-infrastructure/skills/provision-cloudflare-api-tokens/scripts/with-cloudflare-token.sh \
       --persona-id REGISTERED_CREDENTIAL_ID \
       --persona-token-var TOKEN_KEY_FROM_ROUTE \
       --persona-account-var ACCOUNT_KEY_FROM_ROUTE \
       --permission-group 'Workers Scripts Write' -- \
     pnpm run deploy:hotfix \
       --incident INC-123 --reason 'Workers Builds unavailable during checkout outage' \
       --operator 'Incident operator' --sha "$HOTFIX_SHA" \
       --confirm-worker example --base-url https://example.com \
       --automation-paused --yes
   ```

   In persona mode the permission flag states the operation's required contract;
   it does not mint or widen the registered token. Use the operation resolver
   and the credential's verification record to establish its actual permissions.
   If the registered selector already supplies `CLOUDFLARE_API_TOKEN` and
   `CLOUDFLARE_ACCOUNT_ID`, direct scoped `nvault run` injection is also valid.

   For a Cloudflare Access protected origin, inject its separately registered
   service token and add
   `--access-client-id-env CF_ACCESS_CLIENT_ID --access-client-secret-env CF_ACCESS_CLIENT_SECRET`.
   Flags carry variable names, never secret values; both must be present before
   work begins. Authenticated probes follow only same-origin redirects, so
   Access credentials cannot be forwarded to a different origin.

   The command clones local Git objects, checks out the exact SHA, installs from
   the frozen lockfile/cache, captures the existing deployment/version, runs
   `hotfix:check`, and runs `hotfix:build`. Ignored `.env`, stale output, and
   local `node_modules` are not copied. Public `NUXT_PUBLIC_*` values are
   forwarded; the SHA and site URL are forced. Cloudflare and Access credentials
   are not passed to checks or builds. Package-read credentials, if supplied,
   reach only installation. The production build alone receives
   `NUXT_OG_IMAGE_SECRET` and `NUXT_SESSION_PASSWORD` if injected; they must be
   the existing stable app values (at least 32 characters), never CI
   placeholders. Missing required secrets fail the app build. The
   production-deploy signal is set during this build so the SEO module also
   rejects its known test placeholder. App scripts are trusted code, not a
   sandbox.

   It uploads with a SHA tag and a unique receipt marker, preserves existing
   runtime vars, identifies that exact upload, and promotes it at 100%. It never
   calls a migration, secret-write or routing command. See Cloudflare's
   [version and deployment model](https://developers.cloudflare.com/workers/versions-and-deployments/)
   and
   [Wrangler commands](https://developers.cloudflare.com/workers/wrangler/commands/workers/#versions-upload).
   Version binding configuration still comes from the committed app; keeping
   schema/resources compatible remains the operator's responsibility.

5. Require the command to finish successfully. It verifies the expected build
   header, the app health endpoint, and a smoke route, then rechecks the active
   deployment. Inspect the affected customer flow and error metrics as well;
   generic health is not proof that the incident itself is resolved. Record the
   result and times in the incident timeline.
   <!-- enforcement: named; mechanism: runHotfix with verify-live; runs at: post-promotion; rejects: failed build identity health smoke or concurrent-deployment proof -->
   <!-- enforcement: none yet; customer-flow verification and incident resolution are manual -->

## Failure and recovery

The printed receipt lives under the repository's **shared Git directory** at
`narduk/hotfix/<run UUID>.json`, with mode `0600`. It survives temporary clone
cleanup and does not dirty the checkout. It records the operator/incident,
source SHA, target, phase, previous and new version/deployment IDs and reduced
proof results. It contains no environment dump or provider error body. It is
local editable evidence, not an immutable central audit log. Copy the sanitized
receipt into the incident record before deleting this repository.

| Last phase / result                                         | Response                                                                                                                        |
| ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `installing`, `checking`, `building`                        | No upload or promotion was requested. Fix the cause and rerun from a clean commit.                                              |
| `uploading`, `uploaded`                                     | A version may exist, but this command has not requested production promotion. Inspect the receipt and provider before retrying. |
| `promoting`, `proving`, or `productionMayHaveChanged: true` | Production may already be changed even if a command timed out. Inspect current deployments first. Do not blindly retry.         |
| `passed`                                                    | The recorded deployment and local live proof passed at that time. Validate the incident's affected flow and reconcile source.   |

A hard kill can leave the last in-progress phase, a lock, and a temporary
`narduk-hotfix-*` directory. Inspect the lock's PID/start time/receipt and
provider state, confirm the owner is no longer running, then remove only that
exact stale lock and owned temporary directory. Never delete a live lock to
force a second deploy.
<!-- enforcement: none yet; stale-lock recovery is deliberately manual -->

On failed proof, the command exits nonzero and **does not automatically roll
back**. The previous release may be the outage or vulnerable version. The
incident commander chooses a known-safe previous version or a fix forward. For
an approved rollback, first ensure nobody else has deployed since the receipt
and inspect provider state with the same scoped credential:

```sh
# Run from apps/web, under the registered recovery nvault selector.
pnpm exec wrangler deployments list --name example --json
NARDUK_ALLOW_MANUAL_PROMOTE=1 pnpm exec narduk-app deploy rollback \
  --name example --account-id ACCOUNT_ID --to PREVIOUS_VERSION_ID
pnpm exec narduk-app verify --live https://example.com --expect-sha PREVIOUS_SHA
```

Use the **explicit version ID** from the receipt or a reviewed known-safe
version; do not guess “previous” after another deployment. A Worker rollback
cannot undo database writes or external side effects. Keep automation held until
a healthy, understood state is restored.
<!-- enforcement: none yet; rollback approval, target suitability and database compatibility are manual -->

The command serializes hotfixes across worktrees sharing one Git directory and
checks deployment IDs before upload, before promotion and after proof. These are
race detection, not an atomic provider compare-and-swap or a cross-machine lock.
The exclusive production hold is still necessary.

## Return to normal delivery

Within the incident response, preserve/push the hotfix branch as soon as GitHub
is available and open a PR with the incident, approval, diff, exact local SHA,
receipt and validation evidence. Merge the same fix through required CI/review.
If a squash/rebase changes the SHA, explicitly record the correspondence. Do not
merge the receipt into application source merely to store it.
<!-- enforcement: none yet; reconciliation is owned by the incident commander -->

Before lifting the hold, ensure the normal production branch includes the fix,
cancel obsolete queued promotions, and arrange a normal build/promotion of the
reconciled commit. Restore the recorded workflow/trigger state and verify that
normal release's SHA, health and affected flow. This avoids an old queued
release overwriting the hotfix. Restore temporary credential custody, update the
incident timeline, and assign root-cause/preparedness follow-ups within one
business day. The incident stays open until production and source agree.
<!-- enforcement: none yet; workflow restoration and reconciliation are manual -->

## Compatibility

`deploy-hotfix` is additive. Legacy `deploy-local` and the lower-level recovery
environment overrides remain available for existing callers. `deploy-local`
keeps its migration behavior but no longer reads Doppler: its build secrets come
from the environment (`nvault run -- narduk-app deploy-local`), and it is **not
this incident procedure**. Use the documented hotfix command for new local
recovery adoption; there is no automatic fleet rollout or continuing
synchronization relationship.
