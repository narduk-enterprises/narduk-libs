# @narduk-enterprises/create-narduk-app

Deterministic, filesystem-only generation of app-owned Narduk Nuxt workspaces.

```ts
import { createNardukApp } from '@narduk-enterprises/create-narduk-app'

await createNardukApp({
  appName: 'harbor-notes',
  capabilities: ['auth', 'seo'],
  targetDir: './harbor-notes',
  noGit: true,
})
```

The CLI is `create-narduk-app`:

```sh
pnpm dlx @narduk-enterprises/create-narduk-app@0.14.8 harbor-notes \
  --display-name='Harbor Notes' \
  --description='A harbor log.' \
  --site-url=https://harbor.example \
  --target-dir=/absolute/path/harbor-notes \
  --capabilities=auth,seo,analytics,uploads,ai,mapkit \
  --visibility=private \
  --local-dev-port=3011 \
  --json
```

## Database backend

Scaffolds carry a D1 database by default: a `DB` binding,
`server/database/schema.ts`, the `#narduk-db` alias, a first migration and the
`db:migrate:*` scripts.

`--no-database` (or `--database=none`) scaffolds an app with no database at all.
The generated `nuxt.config.ts` declares
`nardukCore: { databaseBackend: 'none' }`, so narduk-core's shared `/api/health`
reports `database: "not_applicable"` and stays `ok` instead of degrading a
publication-only app. No D1 binding, no schema, no migrations, no drizzle pins.
App-owned probes register with `registerHealthCheck` from
`@narduk-enterprises/narduk-core`.

The `auth` capability keeps users, sessions and API keys in the app database, so
it is rejected with `--no-database`. The generator scaffolds D1 only; an app
that needs Postgres scaffolds `d1` and declares `databaseBackend: 'postgres'`
with its Hyperdrive binding afterwards.

It supports `--force`, `--no-git`, and `--json`; it never mutates GitHub,
Cloudflare, Doppler, or package registries. The JSON report is returned to the
caller and is not persisted as scaffold metadata. Generated repositories commit
a non-secret `.npmrc` routing `@narduk-enterprises/*` to `https://npm.nard.uk`.
Reads are anonymous; no GitHub Packages credential is required. The opt-in
`scripts/gh-packages-run.mjs` helper remains for break-glass during a mirror
outage. Onboarding commits the frozen lockfile before CI is enabled.

Private generated apps use the pinned shared Nuxt CI workflow: lint, typecheck,
build, formatting, knip and unit tests run on `linux-ci`; the initial single
browser smoke runs on `playwright-isolated`, using its immutable toolchain. The
shared `ci / Required` aggregate covers both. Before enabling CI, onboard the
new repository into both selected-repository runner groups through fleet and
grant it access to the shared workflows. Generated route names do not grant
access, and the generator makes no GitHub or fleet API calls.

Public generated apps run every quality check on GitHub-hosted Ubuntu. Action
references are pinned, superseded runs cancel, and jobs time out. Existing
generated apps remain app-owned; generating a new version does not update them.

Generated CI uses three Chromium shards and one worker per shard for both
visibilities. Private apps call the pinned shared workflow with `linux-ci` and
`playwright-isolated`; public apps run every job on GitHub-hosted Ubuntu. The
public required aggregate accepts only successful static checks, all browser
shards and merged evidence. Failure screenshots, retry traces and retained
failure videos are attached to the reports. `quality:static` includes format,
lint, knip, manifest cross-check, shared-UI pin, typecheck, `build:ci` and unit
tests; `quality` adds browser tests. It builds with `build:ci`, the script CI
builds with, so the local gate is not red where CI is green: plain `build`
throws on any `seo` app with an empty `NUXT_OG_IMAGE_SECRET`, which used to make
the documented local gate unrunnable without knowing two placeholder values out
of band.

## Keeping an app current: `create-narduk-app upgrade`

The generator scaffolds an app once. `upgrade` re-applies the small set of units
the generator still owns afterwards, as a reviewable diff, so an estate app
converges on the reference shape without anyone hand-copying files. It is
**not** a sync, reconcile or drift-control relationship with the app: nothing
runs on a schedule, nothing calls out to a registry or control plane, and
everything outside the table below is never read and never written.

```sh
# Dry run (the default). Prints a unified diff and exits 1 if anything drifted,
# so CI can run it as a check.
pnpm dlx @narduk-enterprises/create-narduk-app upgrade .

# Apply exactly what the dry run printed.
pnpm dlx @narduk-enterprises/create-narduk-app upgrade . --write

# One unit at a time, for a focused pull request.
pnpm dlx @narduk-enterprises/create-narduk-app upgrade . --only .github/dependabot.yml --write
```

`--json` prints the machine-readable report (`schemaVersion: 1`) instead of the
human summary. `--capabilities`, `--database`, `--local-dev-port` and
`--visibility` override the inferred profile; the profile itself is printed on
every run so a wrong reading is visible before `--write`.

### Reading an existing checkout

`upgrade` reads the checkout before it builds the desired units. A new scaffold
is still an `apps/web` monorepo; these rules are only for an app that already
exists.

- **Layout.** `apps/web/nuxt.config.ts` or `apps/web/package.json` is the
  monorepo shape. A `nuxt.config.ts` at the repository root, with no `apps/web`
  app, is a root Nuxt app.
- **Migrate scripts.** On an `apps/web` app, `db:migrate:local` and
  `db:migrate:remote` are proposed only when `apps/web/package.json` already has
  that script. On a root app, a command already in the root `package.json` is
  left alone, including `narduk-app db migrate`. Wrangler
  (`wrangler d1 migrations apply <database> --local` / `--remote`) is proposed
  only when that key is missing. They are not `pnpm --filter web`.
- **Database.** `databaseBackend: 'none'` or `'d1'` in the Nuxt config wins.
  Otherwise a D1 binding in `Config/cloudflare-app.json` (`bindings.d1`) or in
  the wrangler file (`d1_databases` in JSON, JSONC, or `wrangler.toml`) selects
  `d1`. No binding selects `none`, and the migrate scripts are not proposed.
  Auth is inferred from `@narduk-enterprises/narduk-auth` (or a declared
  capability) and is not dropped just because no D1 binding was found.
  `--database` still overrides.
- **Port.** A literal `devServer.port` in that Nuxt config is the dev port. A
  commented-out `devServer` block is ignored, and a `port` nested inside another
  object (for example `https`) is not the dev port. Otherwise
  `narduk.localDevNuxtPort`, otherwise 3000. A non-literal expression such as
  `port: resolvedLocalNuxtPort` is not guessed.
- **Wrangler.** The managed file is `Config/project-lifecycle.json`'s
  `nativeManifests.wrangler` when that path exists and is JSON or JSONC,
  otherwise the first `wrangler.jsonc` or `wrangler.json` under `apps/web` or at
  the repository root. `--only apps/web/wrangler.jsonc` selects that file on a
  root app and on an app whose file is `wrangler.json`. `wrangler.toml` is
  searched for D1 bindings and is not rewritten. `upgrade` still only writes
  top-level `cache.enabled` and does not create the file.

### Ownership

| Path                                        | Owner                                   | What `upgrade` touches                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| ------------------------------------------- | --------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `.github/workflows/ci.yml`                  | app, with one generator-owned pin       | Only the `narduk-enterprises/workflows/.github/workflows/nuxt-cloudflare.yml@<sha>` reference, and only when bundled workflows history shows the app's SHA is older than this generator's pin. A caller already on a newer workflows SHA is left untouched, so a dry run cannot move it backward. A SHA that history does not contain is `unresolved`, never `clean`, and is not rewritten. A `workflows@<sha>` comment beside a pin that does move, moves with it. The caller's inputs — shard count, e2e arguments, build artefact path — are the app's own policy and are never read.                                                                             |
| `.github/workflows/copilot-setup-steps.yml` | generator                               | The whole file. It is sandbox-prep infrastructure and carries no app-specific content by construction.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `.github/dependabot.yml`                    | generator                               | The whole file. See the opt-out below before adopting this one in an app that has added its own `ignore` rules.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `.github/workflows/dependabot-merge.yml`    | generator                               | The whole file. It merges the `safe` (minor + patch) Dependabot lane once CI is green on its exact head; see "Dependabot: two lanes" below.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `.github/actionlint.yaml`                   | generator                               | The whole file, private apps only. It declares the self-hosted runner labels the generated workflows name (`proxmox`, `linux-ci`, and `proxmox-deploy` for the D1 `preview-d1.yml` template), so the shared workflow's `caller-lint` actionlint pass does not reject them as unknown (narduk-libs#778). An app that routes its own workflows to other labels adds them and disowns the file with `# narduk:unmanaged`.                                                                                                                                                                                                                                               |
| `AGENTS.md`                                 | app, with one generator-owned region    | Only the text between `<!-- narduk:router:start -->` and `<!-- narduk:router:end -->`. The heading, the app's prose and every app-added section are never read.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `docs/e2e-testing.md`                       | app, with one generator-owned region    | Only the text between `<!-- narduk:e2e-policy:start -->` and `<!-- narduk:e2e-policy:end -->` — the flake policy and quarantine convention, which have one right answer for every app. The rest of the document describes the app's own specs and is never read.                                                                                                                                                                                                                                                                                                                                                                                                     |
| `package.json` (root)                       | app, with generator-owned script bodies | Only the `scripts` entries `build:ci`, `foundation:check`, `manifests:validate`, and `db:migrate:local` / `db:migrate:remote` on an app with a database. Each is a contract with `narduk-app-tools` or with the Worker build shape. `manifests:validate` is created when missing and left alone once it has a body, because its name is the contract and two valid bodies exist in the estate (#468). Every other key, every dependency, every version and the manifest's own key order are left exactly as they were.                                                                                                                                               |
| `apps/web/wrangler.jsonc`                   | app, with one generator-owned JSONC key | Only the top-level `"cache": { "enabled": true }` object (narduk-libs#672). The path upgrade edits is the checkout's wrangler JSON or JSONC when that file is not this scaffold path, and `--only apps/web/wrangler.jsonc` selects it. Bindings, routes, `account_id`, env blocks and comments stay app-owned. An explicit `"enabled": false` is left alone, and a `cache` with other keys but no flag is reported unresolved rather than rewritten. Missing `cache` is the pre-#658 gap: existing apps never received Workers Cache because this file was seeded. `upgrade` does not create the file. `wrangler.toml` is read for D1 bindings and is not rewritten. |
| everything else the generator emits         | app                                     | Nothing. `README.md`, `SPEC.md`, `CONTRACT.md`, `docs/`, `playwright.config.ts`, the rest of `apps/web/**` and the rest are **seeded**: written once at scaffold time, app-owned from then on, and never read by `upgrade`.                                                                                                                                                                                                                                                                                                                                                                                                                                          |

Two things are deliberately absent from that table, and running the codemod
against the reference app is what settled both. `playwright.config.ts` is not
managed at all: existing apps already carry their own port resolution, list
mode, and (for Buoys) a local prebuilt-Worker launcher, so managing the file
would propose a downgrade. New scaffolds now emit the prebuilt path themselves
(`E2E_PREBUILT_ARTIFACT=1` → `narduk-app e2e-serve <port>`; default remains
`nuxt dev`). `docs/e2e-testing.md` is managed only as a region for the same
reason — Buoys' copy documents its real specs, and a whole-file rewrite would
have handed it a document about a different app. Dependency versions are absent
too: Dependabot owns estate package currency (company-hq `D-TOOLCHAIN-1`), and
two mechanisms editing the same lines is exactly the reconcile relationship this
generator must not have.

`.node-version` is absent from the table for that last reason. It is the app's
declared **Node source** (see "One declared source per toolchain" below), and a
Node version is the same class of fact as a dependency pin: managing it would
make the generator re-impose its own Node on every app it touched. `upgrade`
never reads or writes it; `narduk-app foundation:check:toolchain` is what keeps
an app's own mirrors in step with whatever the app declares. What did change is
that `copilot-setup-steps.yml` no longer contains a Node or pnpm literal at all,
so whole-file management of it can no longer move an app's toolchain version
behind its back.

### Opting a file out

Any managed file can be disowned by the app. Put `narduk:unmanaged` in a comment
in the file's first five lines, in that file's own comment syntax:

```yaml
# narduk:unmanaged
version: 2
```

`upgrade` then reports it as `unmanaged`, never rewrites it, and does not count
it as drift. This is the sanctioned home for an app-owned Dependabot rule — a
security exception's `ignore` entry (company-hq `NARDUK-APP-COMPLIANCE.md` §4)
or a documented app-specific pin — and the reason the dry run prints the line
count a whole-file rewrite would add and remove.

The region targets follow one rule. An existing `AGENTS.md` with no
`narduk:router` markers gets the router block appended at the end, and
`docs/e2e-testing.md` with no `narduk:e2e-policy` markers gets the flake-policy
block appended the same way. The rest of each file is untouched. A
`<!-- narduk:unmanaged -->` header opts either file out. The router block names
the app's shared packages and points at `narduk-app doctor`. A file with only
one marker of a pair is reported `unresolved` and left alone. Apps generated
from this version carry every marker already.

### Dependabot: two lanes

The generated `.github/dependabot.yml` npm update splits into two groups by
`update-types`, over the same packages: `safe` (minor + patch) and `majors`
(major). `.github/workflows/dependabot-merge.yml` merges `safe` on its own once
CI is green on its exact PR head — nobody has to touch it. It then starts main
CI by `workflow_dispatch`, and a run started with `GITHUB_TOKEN` fires no
`workflow_run`, so Promote never saw it (narduk-libs#787). The generated
`ci.yml` therefore has a `promote-dispatch` job. For a bot-dispatched run on
`main`, after every CI job passes, it dispatches `promote.yml` with
`verified-sha` if the commit is still main's head. `promote.yml` is app-owned:
the generated `docs/workers-builds.md` shows the `workflow_dispatch` input and
the `gate` job to add. Until an app adds them, the job posts a notice and the
bump reaches production with the next promoted commit. `majors` always waits for
a person or an agent: a major bump usually needs a code change, and a
workflow-file edit (the `github-actions` ecosystem lane) can never be merged by
a workflow's own `GITHUB_TOKEN` at all, so that lane stays manual regardless.

This replaced a single all-in `dependencies` group. Apps that had adopted the
older canonical shape (`open-pull-requests-limit: 10`, ~10 groups) stacked
roughly ten open PRs, every one editing `pnpm-lock.yaml`, so merging any one
conflicted the rest and Dependabot rebased — and re-ran CI for — the whole
stack. Collapsing to one combined group was not the fix either: a single
breaking major held every harmless patch bump red behind it (typescript 5→6 and
vitest 4→5 landing in the same PR as ~24 otherwise-safe updates). Two lanes
split by update type is the shape `gonogo` adopted first (gonogo#104, merged as
`0c464d8`) and this generator now matches.

**A `pnpm.overrides` entry pinning a sibling of a package the safe lane bumps
must use pnpm's `$<direct-dep>` reference, or it reddens the lane on every
bump.** gonogo's first safe PR (#106) went red on
`@nuxt/kit does not provide an export named 'buildDiagnostics'`: `nuxt` bumped
to 4.5.2 but the override pinning `@nuxt/kit` was a literal `"4.4.8"` that
Dependabot never touches, so kit stayed behind; gonogo#108 fixed it with
`"@nuxt/kit": "$nuxt"`, which tracks whatever `nuxt` resolves to and was
verified to move to 4.5.2 alongside it (removing the override outright instead
pulled in three copies of kit). This generator's own `@nuxt/kit` override in
`manifest.ts` is the same literal shape and carries the same risk, but cannot
take the plain `$nuxt` substitution today — pnpm only resolves `$<name>` against
a dependency declared in the _same_ `package.json` as the override, and here
`nuxt` lives in `apps/web/package.json` while `pnpm.overrides` lives in the root
manifest (confirmed empirically: a bare `$nuxt` there fails `pnpm install` with
`Cannot resolve version $nuxt in overrides`). Fixing it needs `nuxt` anchored as
a real root-manifest dependency too, which is the broader follow-up
narduk-libs#282 already tracks and this PR does not do.

An existing app adopts both files the same way as any other managed unit:

```bash
pnpm dlx @narduk-enterprises/create-narduk-app upgrade . \
  --only .github/dependabot.yml --write
pnpm dlx @narduk-enterprises/create-narduk-app upgrade . \
  --only .github/workflows/dependabot-merge.yml --write
```

The generated `.github/dependabot.yml` declares one scope-less `npm-nard-uk`
registry for `https://npm.nard.uk`, and the npm update lists it
(narduk-libs#1129). Dependabot's proxy refuses egress to hosts the file does not
declare, so without it every `@narduk-enterprises/*` lookup is a 403
(agent-infrastructure#1940). The token is the org-level
`NPM_NARD_UK_PLACEHOLDER` Dependabot secret, a non-credential value: the mirror
is anonymous, but GitHub's validator rejects a plaintext token and a URL-only
entry. Never add `scope:` to the entry; it makes Dependabot discard the
committed `.npmrc` (agent-infrastructure#1405). coding-standards
`scripts/check-dependabot-template.py --file --npmrc` checks the shape.

`upgrade` reads the app's registry before it touches this file. `.npmrc`'s
`@narduk-enterprises:registry` wins, then an unscoped `registry=` line, and the
lockfile is the fallback. Hosts are compared with `new URL(value).host`, so a
lookalike URL is not the registry. An app on `https://npm.pkg.github.com` is
never given `npm.nard.uk` or `NPM_NARD_UK_PLACEHOLDER`. An app on
`https://npm.nard.uk` is never given a scope-bearing GitHub Packages registry. A
file that already targets that registry, has an npm `updates` block, and sets
`cooldown.default-days: 0` (with `semver-major-days` absent or 0) is left
untouched, including its own `ignore` rules. A github-actions-only file is not
that match. Anything else is rewritten to the template for the registry the app
actually uses. When the registry cannot be told, a missing file is left missing
rather than created from the placeholder-token template. Opt out with
`# narduk:unmanaged` when the app's rules should stay even if they disagree.

### How a narduk-app stays current

1. **Adopt the check.** Run `create-narduk-app upgrade .` in CI, or locally
   before a release. A non-zero exit means a managed unit has drifted.
2. **Read the diff before applying it.** The dry run is the review; `--write`
   applies exactly what it printed. Use `--only` to keep a pull request to one
   unit.
3. **Decide which side is right.** If the app is right and the template is
   stale, the fix lands _here_, in the generator, and the app adopts the next
   release — company-hq `NARDUK-APP-COMPLIANCE.md` §3.9, "shared behaviour is
   fixed upstream, never worked around in the app". If the app genuinely needs
   to differ, it opts the file out with a marker and records why.
4. **Re-run until clean.** `upgrade` is idempotent: a second `--write` writes
   nothing and a following dry run exits 0.

### Moving the Workers toolchain pins

The generator writes `wrangler` and `@cloudflare/workers-types` once, at
scaffold time. After that they belong to the app, and the scaffolded
`.github/dependabot.yml` moves them with everything else in one weekly grouped
pull request. `upgrade` never touches them. A new scaffold pin changes nothing
in an existing app. An app gets the new versions from its own Dependabot PR, or
from a hand bump.

These packages move together. The grouped Dependabot PR moves them together, so
don't split them with `ignore` rules:

| Package                                  | Why it moves with the others                                                                                                                                                                                                               |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `wrangler`                               | Every release from 4.129 ships Miniflare 5, which refuses Miniflare 4's constructor options with `ERR_VALIDATION workers: undefined`. The first release that also clears the `sharp` and `undici` advisories is 4.131.                     |
| `@narduk-enterprises/narduk-testkit`     | `narduk-testkit/d1` (`createD1QueryHarness`) runs on Miniflare 5 from 1.6.3. Older versions fail every D1 harness test once `wrangler` passes 4.128.                                                                                       |
| `@cloudflare/workers-types`              | 5.20260921.1 and later declare a global `Buffer`. A test that calls `chunk.toString('utf8')` on child-process output typed `string \| Buffer` stops typechecking. Call `child.stdout.setEncoding('utf8')` and treat the chunks as strings. |
| `miniflare`, if the app pins it directly | It must be the major that `wrangler` ships.                                                                                                                                                                                                |

Two things Dependabot will not do for you:

- **It does not touch `pnpm.overrides`.** An app that pinned a transitive
  version to clear an advisory, such as `"sharp": "0.35.4"` or
  `"undici@7": "7.29.1"`, keeps that pin after the bump that made it
  unnecessary. It can later hold the transitive dependency back. Once the
  grouped PR merges, remove the override in a follow-up PR. Run `pnpm install`
  and `pnpm dedupe`, check with `pnpm why <package>` that the version you wanted
  still resolves, and run `pnpm audit --audit-level high`.
- **It does not fix app code.** If the grouped PR is red because of app code,
  such as the `Buffer` typing above, fix that code on `main` in its own PR. Then
  comment `@dependabot recreate` on the grouped PR. Don't push commits onto the
  Dependabot branch.

To bump by hand, move every row of the table in one change. Because the PR is
your own, drop any overrides the bump makes unnecessary in the same change. Then
run `pnpm dedupe` and the app's full gate. Without `pnpm dedupe`, the lockfile
can keep the old Miniflare 4 tree beside the new one.

## One declared source per toolchain

A scaffold declares its Node version **once**, in `.node-version`, and its pnpm
version **once**, in the root manifest's `packageManager` (Logan, askme
2026-09-17: _"Single-source toolchain versions (Recommended)"_). Nothing else
restates either value except where a tool can read it from nowhere else:

| Site                                         | Node             | pnpm             | Why                                                                                                                                                         |
| -------------------------------------------- | ---------------- | ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `.node-version`                              | **source**       | —                | read natively by `actions/setup-node` (`node-version-file`), fnm, mise and nodenv, and the only Node declaration a workflow can point at instead of copying |
| `package.json` `packageManager`              | —                | **source**       | read natively by corepack, pnpm itself, and `pnpm/action-setup`                                                                                             |
| `package.json` `engines.node` / `volta.node` | mirror           | —                | Volta and npm read a version from a manifest and nowhere else                                                                                               |
| `.github/workflows/ci.yml`                   | reads the source | reads the source | `node-version-file: .node-version` to the shared workflow (workflows#97); the shared workflow's pnpm step resolves `packageManager`                         |
| `.github/workflows/copilot-setup-steps.yml`  | reads the source | reads the source | `node-version-file: .node-version`; `pnpm/action-setup` with **no** `version:` input                                                                        |
| `docs/workers-builds.md`                     | mirror           | mirror           | the repo's record of the Cloudflare dashboard build environment, which no checkout can read                                                                 |

No `.nvmrc` is emitted. Every consumer in this estate that reads `.nvmrc` also
reads `.node-version` (setup-node, fnm, mise); the only tool that reads `.nvmrc`
and not `.node-version` is `nvm`, which is not the installed manager here — and
Volta, which is, reads neither. A second dotfile with no exclusive consumer is a
drift site, so there is not one.

`narduk-app foundation:check:toolchain` enforces all of this against any app,
and `--fix` rewrites a drifted mirror to its source, so bumping Node is one edit
to `.node-version` plus one `--fix`.

Passing `node-version-file` requires the shared workflow pin to be
`6f56678ad7562234e465284e48f27008e0f32db7` (workflows#97) or later — a reusable
workflow rejects an input it does not declare, so this is not an optional bump.
The generator pins `1513b2a2f4b147b2e625478e56eb9de0cc5d5399` (workflows#116) so
a tokenless `https://npm.nard.uk` caller also gets the install and
foundation-check mirror skips (#108 / #116). That pin still includes #97's
always-run required `caller-lint` job which actionlints the **calling**
repository's own workflows and audits them for workflow-level concurrency, a
top-level and per-job `permissions:` block, per-job `timeout-minutes`, and
40-character SHA pins. Every workflow this generator emits satisfies those
rules, and `tests/toolchain-single-source.test.ts` re-runs the gate's own checks
over the generated output so the templates cannot drift back.

## Buoys-shape parity

Scaffolds match the reference app shape Buoys is being brought to
(narduk-enterprises/company-hq#745):

- `nuxt.config.ts` registers `@nuxt/icon` explicitly alongside
  `@narduk-enterprises/narduk-core`. Narduk UI nests its own `installModule`
  call for the Nuxt Icon client bundle, but that nested registration does not
  finish before the build step that consumes `#build/nuxt-icon-client-bundle`,
  so an app that omits the explicit module fails to build with
  `[UNLOADABLE_DEPENDENCY] Could not load .nuxt/nuxt-icon-client-bundle`.
- `apps/web/package.json` pins `nitro-cloudflare-dev` alongside the other
  build-critical devDependencies.
- `.github/workflows/copilot-setup-steps.yml` is generated for every visibility,
  with `concurrency` and a job `timeout-minutes`.
- `.github/dependabot.yml` groups npm and `github-actions` updates with a single
  `directory` per ecosystem.
- Root `package.json` carries `build:ci`, `foundation:check`, and
  `manifests:validate` scripts, plus the `@narduk-enterprises/narduk-app-tools`
  devDependency that backs them. `apps/web/scripts/validate-manifests.mjs` runs
  pre-deploy and fails the build when `apps/web/wrangler.jsonc` bindings
  disagree with `Config/cloudflare-app.json`. Both files are generated together
  and agree from the first commit, so this is a real cross-check immediately; it
  still no-ops rather than throwing when the declaration is absent, for apps
  scaffolded before the generator wrote one.
- `CONTRACT.md` and `docs/workers-builds.md` are generated alongside
  `README.md`/`AGENTS.md`, documenting the app's own health contract and its
  Cloudflare Workers Builds connection settings.
- `playwright.config.ts` splits a `setup` project (global auth/session
  bootstrap) from a `chromium` project that depends on it. Local
  `pnpm run test:e2e` still starts `nuxt dev`. `E2E_PREBUILT_ARTIFACT=1` (the
  shared `nuxt-cloudflare` callable) runs `narduk-app e2e-serve <port>` against
  the already-built Worker instead.
- `docs/e2e-testing.md` and `apps/web/tests/e2e/visual-audit.spec.ts` describe
  and exercise the generated Playwright layout. The visual-audit spec is a
  generic, one-route (`/`) skeleton built on narduk-testkit's
  `playwright/ui-quality` toolkit (`createConsoleTracker`,
  `captureFullPageAudit`, `captureNamedLocator`, `prepareUiQualityRoot`,
  `writeUiQualityManifest`) across mobile/tablet/desktop viewports, and asserts
  a clean console via `consoleTracker.expectClean()`. It intentionally does not
  replicate Buoys' own app-specific routes, selectors, or its
  wrapper-script/analyzer CLI infrastructure — those stay app-owned.

A freshly generated app is web-foundation conformant once its database exists:
`pnpm run foundation:check` reports `PASS`, before or after its first build,
after one command. Generated CI calls the shared workflow with
`foundation-check: true`, which fails the build on a `FAIL` **or** an `UNKNOWN`
result.

That one command is `pnpm exec narduk-app db create`. The generator never calls
Cloudflare, so the `DB` binding in `apps/web/wrangler.jsonc` carries the
placeholder `database_id` `00000000-0000-0000-0000-000000000000`. Every build,
dry-run and test accepts it, but no request that touches the database can
succeed, so `foundation:check` sub-check 1.5 fails on it, deliberately, until
the database is created (narduk-libs#662). `db create` creates `<app>-db` in the
account named by `CLOUDFLARE_ACCOUNT_ID`, writes the returned id into
`apps/web/wrangler.jsonc` with its comments intact, and prints the id and
account. The generated `README.md`, `docs/workers-builds.md` and a comment above
the binding all say so. A `--no-database` scaffold has no D1 binding and passes
untouched.

Earlier versions were not. The generator left `Config/cloudflare-app.json` to
onboarding, so item 1.2 was a decided FAIL (`apps/web/wrangler.jsonc` exists but
the declaration does not), 1.4/3.1/3.2 were `UNKNOWN` for want of
`access.exposureClass`, and 1.1 failed as soon as a build had run
(narduk-libs#350). This README previously called that "expected and not a
generator defect"; it was one, and nothing inside a new app could fix it. The
generator now writes the half of that file a checkout can know — product
identity, the Worker shape, the exposure class and the bindings mirror — and
leaves the live Cloudflare facts (`product.repository`, the account id,
`domains`, the `deployment` block) to onboarding, absent rather than fabricated.
`packages/tooling/narduk-app-tools/tests/foundation/generated-app-conformance.test.ts`
runs the real checker over real generator output and is what keeps this true:
1.5 is the only thing an untouched scaffold fails, and after `db create` it
passes.

One check is deliberately outside the local chain. `foundation:check` reads the
package registry over the network, so it stays out of `quality:static`. Default
generated apps read `https://npm.nard.uk` anonymously and do not need a GitHub
Packages credential. An app still routed at GitHub Packages reports `UNKNOWN`
and exits 2 without one. The generated README says which of the three gates is
which.

## Workers Builds and previews

Workers Builds deploys protected `main`; enable non-production branch builds and
GitHub PR comments during onboarding so trusted PR branches receive preview
URLs. The generator emits the commands and explicit `workers_dev` /
`preview_urls` flags but never creates provider connections. Public apps enable
both flags. `--exposure authenticated` closes both for internal or authenticated
apps; selecting the `auth` capability defaults to that exposure and rejects
`--exposure public`. Repository `--visibility` is independent: a private
repository can serve a public app. Version previews share runtime bindings;
isolate private data and write-capable bindings before enabling them. Keep
previews noindex and analytics disabled.

Workers Builds does not inject `wrangler.jsonc` `vars` into `nuxt build`.
Generated `docs/workers-builds.md` records that contract: public analytics and
geolocation keys live on the Worker, and narduk-core's request-time overlay
fills `__NUXT__`. New apps must not add a `nuxt.config.ts` helper that reads
wrangler at build time.
