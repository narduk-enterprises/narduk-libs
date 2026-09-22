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
validation runs only when you ask for it and on exit.

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
the `checks` gate. `install` must be a frozen install. `automation` classifies
every workflow and names the `inventoryReference`: the human inventory that also
covers GitHub Apps, dependency bots and cron. Commands are literal argv, never
shell text. The schema, with comments, is `src/development-config.ts`.

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

## The daily loop

```sh
pnpm run deploy:dev                      # web package: narduk-app development deploy
pnpm run deploy:dev -- --handoff "open /settings and try the new filter"
narduk-app development status [--remote]
```

Each deploy:

1. takes the target lock (shared across every clone and worktree on the host);
2. captures the checkout: tracked edits, deletions and unignored untracked
   files;
3. refuses if the target serves something other than what this record last
   proved. Someone changed it out of band; see recovery below;
4. runs the target set's checks, builds in a private reusable workspace (the
   frozen install runs only when dependency inputs change), and runs
   `assertArtifact`;
5. uploads a version tagged with its build ID, promotes it at 100%, and proves
   it: exact `x-build-version`, health envelope and smoke path, then your
   `behavior` probe.

Outcomes (the receipt under `receipts/` records names, never values):

| Outcome                 | Meaning                                                                                                                                                                   |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `verified`              | Serving and proven.                                                                                                                                                       |
| `awaiting-owner`        | Serving. The component declares an owner-only behavior proof; the owner confirms it.                                                                                      |
| `refused`               | A gate failed before anything uploaded. Nothing changed.                                                                                                                  |
| `failed-before-traffic` | Uploaded but not promoted; the previous version still serves.                                                                                                             |
| `unproven`              | Promoted, but proof failed. **It is serving.** The receipt says exactly what serves. Fix forward with another deploy. There is no automatic rollback in development mode. |

Commit locally as often as you like. Pushing is fine too and triggers nothing
while held.

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
- **Secrets**: stage runtime secrets with the provider CLI under `secret-stage`.
  Receipts carry names only. A deploy whose declared `requiredRuntimeSecrets`
  are missing ends `failed-before-traffic`.
- **Recovery**: when the target was changed out of band, inspect the change,
  then record the fix under `recovery` so the record matches what serves.

## Explicit validation

```sh
narduk-app development validate --ref <branch> --sha <full sha> --reason "<why now>"
```

This pushes the exact commit to `narduk-validation/<sha>/<uuid>`, and that push
alone triggers `validate.yml`. Because it is a push event on the candidate
commit, the run's `ci / Required` counts for a pull request at that head. Use it
before merging a PR while the mode is active, or whenever you want a full-CI
answer. It never deploys.

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

| Symptom                        | Action                                                                                                                                                                               |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| A deploy was interrupted       | `development resolve` records what actually serves and closes the attempt as `unproven` or `failed-before-traffic`.                                                                  |
| `lock held`                    | Another command on this host holds the target. Wait for it. If its process is gone: `development resolve --release-stale-lock`. It refuses to release a live or remote owner's lock. |
| "serves X, not the verified Y" | Something changed the target out of band. Inspect it, then fix it under `exec --operation recovery`.                                                                                 |
| `unproven`                     | It is serving. Read the receipt, fix, deploy again.                                                                                                                                  |
| Production is on fire          | Break-glass is separate and incident-only: [local hotfix](local-hotfix.md). It participates in the same target lock.                                                                 |

Never use legacy `deploy-local`, `--skip-checks`, `--force-production`, or a
hand-run `wrangler deploy` against an enrolled target. Each bypasses the record,
and the next deploy refuses on the mismatch.
