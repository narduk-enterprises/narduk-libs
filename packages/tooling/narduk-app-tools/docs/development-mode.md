# Development mode

Development mode lets one approved workstation own an app's enrolled Cloudflare
target while the app is being built. From that checkout, uncommitted edits
included, `pnpm run deploy:dev` gates, builds, uploads, promotes and proves a
version in about half a minute. The automation that would otherwise overwrite
the target is held for the whole period: push and merge workflows, and Workers
Builds triggers. It is restored exactly when you exit.

The authorizing plan is
[company-hq#781](https://github.com/narduk-enterprises/company-hq/issues/781).

## Which path to use

| Situation                                                                                                                   | Path                                                                                                                                                                                |
| --------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The app has users who depend on reviewed, validated releases                                                                | **Normal delivery**: push, CI, Workers Builds upload, gated promotion. This is the default. Every app not enrolled stays here.                                                      |
| The app is being built, the owner accepts that its target serves unreviewed work, and one person or agent is iterating fast | **Development mode** (this document)                                                                                                                                                |
| Production is broken and the normal path cannot fix it in time                                                              | **Break-glass** ([local hotfix](local-hotfix.md)). Incident-only, clean-commit, recorded. Development mode never substitutes for it, and it never substitutes for development mode. |

Development mode does not weaken any gate. Required checks, rulesets and the
promotion workflow are unchanged. While the mode is active they are simply not
triggered, and exit cannot finish until the exact release commit passes them.

## What enrollment changes, and what it never does

Enrollment:

- inventories **every** workflow in the repository and refuses if any active
  workflow is unclassified;
- disables the workflows listed in `automation.workflows`, and settles their
  in-flight runs. Credentialed writers finish naturally; others are cancelled;
- snapshots, then deletes, the Workers Builds triggers of each enrolled Worker,
  including their build variables. Protected (secret) variables must each have a
  declared `buildVariableSources` vault selector, or entry refuses: Cloudflare
  never returns their values, so there must be a restoration source;
- writes a host-private activation record under
  `$XDG_STATE_HOME/narduk-app-tools/development/`, the custody grant. The config
  in the repository only declares the capability.

It never:

- touches `independentWorkflows` or `continuingWriters`. Independent production
  paths stay live and are inventoried only;
- disables the explicit validation workflow;
- changes branch protection, rulesets or required checks;
- enrolls an app on upgrade. A newer generator or app-tools release does not add
  `deployment.development`; only an owner does, by editing the config and
  running `development enter`.

Ordinary pushes run **no** CI while the mode is active. That is deliberate. Full
validation runs after every verified deploy, in the background (see
[Validation after every deploy](#validation-after-every-deploy)), when you ask
for it, and on exit.

## Enrollment

Prerequisites (owner):

1. A private repository with `.github/workflows/validate.yml`, the explicit
   validation caller (`on: push: branches: ['narduk-validation/**']`, calling
   the shared `nuxt-cloudflare.yml` at `67968e3` or later with
   `expected-candidate-sha: ${{ github.sha }}`). `create-narduk-app` generates
   it for private apps; copy it for older apps.
2. A valid narduk-v1 `deployment` block in the repository-root
   `Config/cloudflare-app.json`, including `liveProof`.
3. Owner acceptance of the serving hostname. A root/production hostname is
   allowed, but its origin must be listed in `origins`, and the owner must
   accept that it will serve development builds.
4. Registered credential selectors (nvault project, environment, config, key)
   for the Worker deployment credential and the Workers Builds control
   credential. Use the registered routes; never guess a selector.

Declare the capability under `deployment.development`. Each component needs
`appDir`, `wranglerConfig`, `accountId`, `workerName`, `origins`, `bindings`,
`build`, `assertArtifact`, `behavior`, `artifactDirectory`,
`deploymentCredential` and `buildsCredential`. A target set lists components and
the `checks` gate. `install` must be a frozen install; `installSecrets` supplies
its package-read credential (for example `GH_PACKAGES_READ` for
`gh-packages-run`), resolved only when dependencies must be reinstalled.
`automation` classifies every workflow and names the `inventoryReference`: the
human inventory that also covers GitHub Apps, dependency bots and cron. Commands
are literal argv, never shell text. The schema, with comments, is
`src/development-config.ts`.

`assertArtifact` is where you prove the build is the right environment. Assert
the production configuration, and assert that no development-only or test-only
value reached the artifact. It runs before anything uploads.

Then, from the checkout that will publish:

```sh
narduk-app development enter --approval-ref <issue-or-decision> --publisher <id> --dry-run
narduk-app development enter --approval-ref <issue-or-decision> --publisher <id>
```

The dry run lists what would be held and restored. Entry is journaled. If it is
interrupted, re-run the same command and it resumes. After editing the
declaration, `enter --refresh` re-verifies the holds.

A held workflow that is already `disabled_*` at entry has an ambiguous prior
state: the tool cannot tell an intentional disable from a stale hold left by
something else. `enter` and `enter --dry-run` refuse and name the paths.
`--refresh --dry-run` only treats newly declared held paths as ambiguous;
workflows this enrollment already holds are the live hold, not prior state.
Re-enable them first so entry captures the true restore state, or pass
`--accept-prior-state` to record the live disabled state as the intended restore
state (journaled). Retired workflows (`automation.retiredWorkflows`) are not
ambiguous — they stay disabled on exit by declaration. Exit names any workflow
it restores to a disabled state. `development status` lists those restore
targets too.

## The daily loop

```sh
pnpm run deploy:dev                      # web package: narduk-app development deploy
pnpm run deploy:dev -- --handoff "open /settings and try the new filter"
pnpm run deploy:dev -- --gated           # the capture changes protected paths
pnpm run deploy:dev -- --red-main-fix 42 # this deploy fixes red-main issue #42
narduk-app development status [--remote]
```

Each deploy:

1. takes the target lock (shared across every clone and worktree on the host);
2. refuses if `main` has been red for more than 24 hours (see
   [Red main](#red-main));
3. refuses if the target serves something other than what this record last
   proved. Someone changed it out of band; see recovery below;
4. captures the checkout: tracked edits, deletions and unignored untracked
   files, and refuses a capture that changes protected paths unless run with
   `--gated` (see [Protected paths](#protected-paths-and---gated));
5. runs the target set's checks, builds in a private reusable workspace (the
   frozen install runs only when dependency inputs change), and runs
   `assertArtifact`;
6. uploads a version tagged with its build ID, promotes it at 100%, reconciles
   the Worker's script-level crons and routes from the artifact
   (`.output/server/wrangler.json`, falling back to the source Wrangler config
   when the artifact omits those keys), and proves it: exact `x-build-version`,
   health envelope and smoke path, then your `behavior` probe. Version promotion
   carries code only; without the trigger step, a cron or route change would
   never apply;
7. after a `verified` or `awaiting-owner` deploy, queues full validation of the
   deployed commit and returns without waiting for it (see
   [Validation after every deploy](#validation-after-every-deploy)).

Outcomes (the receipt under `receipts/` records names, never values):

| Outcome                 | Meaning                                                                                                                                                                                |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `verified`              | Serving and proven.                                                                                                                                                                    |
| `awaiting-owner`        | Serving. The component declares an owner-only behavior proof; the owner confirms it.                                                                                                   |
| `refused`               | A gate failed before anything uploaded. Nothing changed.                                                                                                                               |
| `failed-before-traffic` | Uploaded but not promoted; the previous version still serves.                                                                                                                          |
| `unproven`              | Promoted, but proof failed. **It is serving.** The receipt says exactly what serves and what the rollback decision was. Fix forward, or roll back by hand (see [Rollback](#rollback)). |
| `rolled-back`           | Proof failed and the app's automatic rollback moved serving back to the last verified build, which was proven again. Exit code 1.                                                      |

### Timings

Every receipt carries `timings` (seconds per phase), `steps` (seconds and
pass/fail for each check, build, `assertArtifact`, schema check, upload,
promote, trigger apply, proof and behavior probe) and `totalSeconds`. The deploy
prints one line with the total and the five slowest steps, so the check worth
trimming from `checks` is visible rather than guessed. A failed step is recorded
with its time before the deploy refuses.

Commit locally as often as you like. Pushing is fine too and triggers nothing
while held.

### Protected paths and `--gated`

Some changes take the gated route even in development mode: auth, session,
payment and credential code, migrations, and Worker binding or Durable Object
changes. deploy:dev diffs the capture against the last verified capture on this
workstation (or, before the first one, against the merge base with
`origin/<productionBranch>`) and refuses when the diff touches:

- a glob in `deployment.development.protectedPaths` (`*`, `**`, `?`, matched
  against repository-relative paths). When the app declares none, the defaults
  are `**/auth/**`, `**/session/**`, `**/sessions/**`, `**/payments/**`,
  `**/billing/**` and `**/credentials/**`. Declaring a list replaces the
  defaults;
- any file under a `migrationDirectories` entry;
- the binding declarations of a component's Wrangler config (D1, KV, R2,
  services, queues and the rest; `vars`, crons and routes are not bindings), or
  its Durable Object bindings and class migrations.

`--gated` deploys it anyway, records the matched paths in the receipt's `gate`,
and marks the validation queued after the deploy as gated. When no base can be
established (no verified capture here and no fetched production branch), the
deploy refuses unless `--gated`.

### Red main

When the repository has an open issue labelled `red-main` that is more than 24
hours old, deploy:dev refuses: red is fixed or reverted, not built on. A deploy
that is the fix names it with `--red-main-fix <issue>`; naming an issue that is
not an open `red-main` issue refuses too. A younger red-main issue is printed
and does not block. The receipt's `redMain.status` is `clear` (no open red-main
issue), `red` (one is open, blocking or not yet), or `fix` (this deploy names
one). If GitHub cannot be read, the receipt records `redMain.status: unknown`
and the deploy proceeds with a warning: the guard stops red from accumulating,
it is not the gate on one deploy.

The workspace is a repository of its own: the captured tree is committed there
under a local branch with no remote, so checks written as
`git rev-parse --show-toplevel`, `git ls-files -co --exclude-standard` or
`git status` see exactly the captured source. The publisher's git identity,
signing, hooks and init templates are excluded from it.

### Several contributors, one publisher

Only the recorded publisher, on the recorded workstation, from the recorded
integration checkout, can deploy. Other worktrees and agents feed that checkout
with commits (merge or cherry-pick). A deploy from anywhere else refuses and
names the checkout to use. To move custody, see handoff.

### Feedback pins

While someone is evaluating a specific build, freeze it:

```sh
narduk-app development pin --scenario feedback-round.md
narduk-app development unpin --feedback-ref <where the feedback was recorded>
```

A pin refuses deploys, migrations and secret changes until it is closed.

## Migrations, secrets and recovery operations

Anything that changes remote state besides a deploy goes through `exec`. It runs
under the same target lock and is recorded:

```sh
narduk-app development exec --operation migration --approval-ref <ref> --commit <full sha> -- <command...>
narduk-app development exec --operation secret-stage --approval-ref <ref> -- <command...>
narduk-app development exec --operation recovery --approval-ref <ref> -- <command...>
```

- **Migrations** run only from a frozen local commit. The files in
  `migrationDirectories` must match that commit exactly, and once applied they
  are immutable. Editing an applied file, or pointing at a commit whose sources
  differ, refuses. Write expand-then-contract migrations, exactly as in
  [D1 deployment migrations](deployment-migrations.md). The development database
  is often the retained production database.

  The promote path's expand-only rule (foundation sub-check 12.9) applies here
  too, before the command runs. A `.sql` file this run may apply that drops or
  renames a table, view or column refuses. A file is judged unless it is
  recorded as applied here with the same bytes, or, only for an app that
  declares no `deployment.migrations`, it was byte-identical on the production
  branch as this checkout had fetched it before the hold took effect. Such an
  app has 12.9 NA under normal delivery, so nothing ever judged its history, and
  a table rebuild there does not block later development migrations. An app that
  declares `deployment.migrations` (expand-contract, like narduk-farm) gets no
  such exemption: foundation 12.9 already judges every file on every run, so a
  green main has every drop or rename waived by checksum, and a pre-enrollment
  drop without a waiver is one normal delivery failed, not one it shipped.
  Development mode judges every file for it, refusing the unwaived one and
  classifying a waived one as `contract`. A fresh entry records that commit as
  `migrationBaseline` from `origin/<productionBranch>` just before it holds
  anything (fetch before entering; a stale ref only makes the check stricter). A
  file that lands on the production branch while the hold is on skipped the held
  CI, so it is always judged. An enrollment without a baseline judges every
  tracked file; `development enter --refresh` recovers one only from this
  checkout's reflog of `origin/<productionBranch>`, as fetched a whole second
  before the enrollment's `enter-started` event, never from the current ref, so
  fetching now does not help. If the reflog does not reach back that far,
  nothing is recorded. A baseline is never moved once recorded. The one
  exception is a reviewed contract migration: declared under
  `deployment.migrations.contractMigrations` with its exact checksum **and**
  already landed byte-identical on `origin/<productionBranch>`. Contract
  migrations are reviewed on the gated path; development mode never introduces
  one. Each applied migration records `compatibility` (`expand-only` or
  `contract`), which rollback reads.

- **Secrets**: stage runtime secrets with the provider CLI under `secret-stage`.
  Receipts carry names only. A deploy whose declared `requiredRuntimeSecrets`
  are missing ends `failed-before-traffic`.
- **Recovery**: when the target was changed out of band, inspect the change,
  then record the fix under `recovery` so the record matches what serves.

## Validation after every deploy

After a `verified` or `awaiting-owner` deploy, deploy:dev queues full validation
of the deployed commit and returns; nobody waits on CI. The deployed commit is
the base commit for a clean capture. For a dirty one it is a commit whose parent
is the base commit and whose tree is exactly what `git add -A` would stage from
the capture: tracked edits and deletions plus unignored untracked files, never
ignored additional build inputs. It is written with plumbing only (no hooks,
filters, signing or local identity) and kept reachable at
`refs/narduk/development/validation`; the checkout's index and working tree are
untouched.

A detached worker (`narduk-app development validation-worker`, logging to
`$XDG_STATE_HOME/narduk-app-tools/development/validation/<repo>/worker.log`)
pushes it to `narduk-validation/<sha>/<uuid>`, which triggers `validate.yml`:
the full CI, e2e included, on the exact tree production serves, and that tree is
now on GitHub. One worker runs per repository on a host. A newer deploy replaces
a queued commit that has not been pushed yet, and once the newer one is pushed
the worker cancels the unfinished runs of the older automatic requests and
deletes their branches, so the newest deployed SHA wins and at most one
automatic `narduk-validation/*` branch per repository stays on GitHub (a failed
delete is retried by every later successful push, and the worker history keeps
that entry past its 20-entry limit until the delete succeeds). Run results stay
after their branch is deleted, but the pushed commit, uncommitted edits included
for a dirty deploy, stays fetchable by SHA until GitHub collects it. Each push
starts the app's full `validate.yml`, e2e shards included, on the shared
runners. Explicit `development validate` requests are never cancelled or
deleted.

The receipt's `validation` says what was queued, or why nothing was; the push
happens after the receipt is written. A push that fails twice is recorded in the
worker's history, and `development status` then shows the latest automatic
request as `NOT PUSHED` with the error: run `development validate` for that
commit.

A red validation files nothing by itself here; the repository's red-main routing
(and the 24 hour guard above) owns what happens next.

## Explicit validation

```sh
narduk-app development validate --ref <branch> --sha <full sha> --reason "<why now>"
```

This pushes the exact commit to `narduk-validation/<sha>/<uuid>`, and that push
alone triggers `validate.yml`. Because it is a push event on the candidate
commit, the run's `ci / Required` counts for a pull request at that head. Use it
before merging a PR while the mode is active, or whenever you want a full-CI
answer. It never deploys.

## Rollback

```sh
narduk-app development rollback --to <known-good build id> [--dry-run]
```

Moves every component of the target set back to a known-good build's versions
(the last two verified builds on this workstation), proves them against that
build's ID, and records them as the expected serving versions. It is the
rehearsal command, and the manual path while automatic rollback is off. It
refuses, and a failed deploy pages instead of rolling back, when anything a
Worker rollback cannot undo happened since that build:

- a Durable Object binding or class migration changed;
- any other Worker binding changed;
- a migration applied since that build is a contract migration, or predates the
  expand-only record and so is not proven expand-only.

**Automatic rollback is off by default.** When live proof or the behavior probe
fails, the receipt records `rollback.decision`: `off` (with the manual command
printed), `page` (with the reasons, printed as a `PAGE:` line), `rolled-back`,
or `failed`. Switch it on per app only after a live rollback rehearsal against
the real Worker (deploy N+1, `development rollback --to <N>`, prove, then deploy
forward again):

```json
"development": {
  "rollback": { "automatic": true, "rehearsalRef": "<where the rehearsal is recorded>" }
}
```

The schema refuses `automatic: true` without `rehearsalRef`. Changing the
declaration needs `development enter --refresh`, like any other declaration
change.

## Handoff

```sh
narduk-app development handoff --to <publisher>
narduk-app development handoff --accept <bundle> --publisher <id>   # on the receiving host
```

Handing off suspends publishing here and writes a private bundle. Move it
through approved private custody. Accepting re-checks that every hold is still
in effect and that the target still serves the handed-off version before it
activates.

## Exit: returning to normal delivery

1. `narduk-app development exit --prepare` refuses while an attempt is
   unresolved or a pin is open.
2. Integrate the work with the production branch through a normal pull request.
   After a squash merge the release is the **new** production-branch head, not
   your branch commit.
3. Validate that exact head:
   `development validate --ref main --sha <main head>`.
4. Check out that commit, clean, in the integration checkout, and run:

   ```sh
   narduk-app development exit --release-sha <main head> --validation-run <run id> [--owner-proof-ref <ref>]
   ```

Exit verifies the run (push event, validation ref, exact SHA, successful
required jobs), deploys and proves the release, waits for obsolete runs to
settle, then recreates each Workers Builds trigger with its variables,
re-enables each held workflow to its saved state, and archives the record. It is
journaled. If it stops, for example with "runs are settling", re-run the same
command. The holds stay in place until the release is proven, so a failed exit
is never half-normal.

After exit, confirm the restored trigger builds the next push. On Cloudflare the
trigger ID changes; the definition and variables are what restore.

## When something goes wrong

| Symptom                                | Action                                                                                                                                                                               |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| A deploy was interrupted               | `development resolve` records what actually serves and closes the attempt as `unproven` or `failed-before-traffic`.                                                                  |
| `lock held`                            | Another command on this host holds the target. Wait for it. If its process is gone: `development resolve --release-stale-lock`. It refuses to release a live or remote owner's lock. |
| "serves X, not the verified Y"         | Something changed the target out of band. Inspect it, then fix it under `exec --operation recovery`.                                                                                 |
| `unproven`                             | It is serving. Read the receipt, fix, deploy again.                                                                                                                                  |
| `PAGE:` after a failed proof           | A rollback would cross a Durable Object, binding or non-expand-only migration change. It is serving; fix forward or decide by hand.                                                  |
| "Protected changes since ..."          | The capture touches protected paths or bindings. Deploy with `--gated`, or land the change through a reviewed pull request.                                                          |
| "main has been red for more than 24 h" | Fix main first, or deploy the fix with `--red-main-fix <issue>`.                                                                                                                     |
| Production is on fire                  | Break-glass is separate and incident-only: [local hotfix](local-hotfix.md). It participates in the same target lock.                                                                 |

Never use legacy `deploy-local`, `--skip-checks`, `--force-production`, or a
hand-run `wrangler deploy` against an enrolled target. Each bypasses the record,
and the next deploy refuses on the mismatch.
