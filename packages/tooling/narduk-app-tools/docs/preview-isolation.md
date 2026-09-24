# Preview isolation: generating the preview wrangler config

narduk-libs#473. This implements deployment-standard design §3.3 option A, which
the owner approved on 2026-09-17 with every other recommended option.

## The problem

Under `narduk-v1`, Workers Builds runs `narduk-app deploy versions-upload` on
every branch. Before this change, that command always uploaded
`.wrangler.deploy.production.json`. A Worker version captures its bindings but
not the state behind them, and `preview_id`, `preview_database_id` and
`preview_bucket_name` apply to `wrangler dev` only. So every pull-request
preview of an app with D1, KV or R2 read and wrote production data.

`previewBindings` could name a replacement, but nothing consumed it. Item 12.4
therefore reported `unknown`, and an adopter had to choose between turning
previews off and carrying a permanently amber check.

## The design

**One shared preview resource per binding, per app.** This is option A. Per-PR
resources were option B and were rejected in the design. They need a write
credential in Actions, a hook Workers Builds does not have, and cleanup of
orphaned resources.

1. **The declaration carries the resource.** A `previewBindings` entry names the
   preview resource in wrangler's own field names. KV uses `id`. D1 uses
   `database_id` and `database_name`, because `wrangler d1` commands resolve a
   database by name. R2 uses `bucket_name`.
2. **The build consumes it.** `selectDeployConfig` in `src/deploy.ts` runs for
   `versions-upload` only. When `WORKERS_CI_BRANCH` is not
   `deployment.productionBranch`, it writes `.wrangler.deploy.preview.json` and
   uploads with it.
3. **All or nothing.** `planPreviewConfig` in `src/preview-config.ts` rebinds
   only when every D1/KV/R2 binding has a complete preview entry that is not a
   production resource in any scope. Otherwise the build keeps the production
   config, as before, and prints a `WARNING`. A half-rebound preview would read
   preview data and write production caches under the same keys.
4. **12.4 checks the generated config.** The checker calls the same planner on
   the app's own config, flattened the way the build flattens it. Its verdict
   therefore describes the config a branch build uploads, not the declaration.

## Verdicts

| State                                                      | 12.4               |
| ---------------------------------------------------------- | ------------------ |
| Branch builds off, or no D1/KV/R2 binding                  | `pass` (unchanged) |
| Every binding rebound to a non-production resource         | `pass`             |
| A production binding with no entry                         | `fail` (unchanged) |
| An entry naming no binding of its kind                     | `fail`             |
| A preview id, name or bucket that is a production one      | `fail`             |
| A bare name, or a D1 entry missing its id or name          | `unknown`          |
| A TOML app config, or bindings in a second Worker's config | `unknown`          |

## What stays unchanged, deliberately

- **`deploy` never rebinds.** It serves production traffic.
- **The production branch never rebinds.**
- **Runs outside Workers Builds never rebind.** Without `WORKERS_CI_BRANCH`, a
  local recovery upload keeps the production config.
- **The build does not refuse.** An incomplete declaration keeps today's
  behaviour with a warning, so this release breaks no existing preview build.
  Failing the build closed is a possible later step.
- **Promotion is untouched.** `versions-promote` already refuses a version whose
  recorded branch is not the production branch, and a SHA carried by two
  versions. `--any-branch` or `--version-id` could still promote a preview
  version, which would now carry preview bindings. Those flags are manual
  recovery tools.

## Known limits

- The repository read cannot prove the preview resources exist on Cloudflare.
  That is the tier-2 live read.
- Two open pull requests share one preview dataset, which the design accepts.
  Data-mutating end-to-end tests stay on the runner.
- Only D1, KV and R2 are covered, which matches `PREVIEW_BINDING_KINDS`. Queues,
  Durable Objects and Hyperdrive on a preview still reach production.
