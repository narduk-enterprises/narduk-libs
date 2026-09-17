---
'@narduk-enterprises/create-narduk-app': minor
---

Teach a newly generated app the Narduk deployment standard (company-hq#745,
deployment-standard design §2.1/§3.2; Logan approved every recommended option on
2026-09-17).

`docs/workers-builds.md` previously taught the pre-standard model: a production
deploy command that **deploys**, and non-production branch builds enabled for
trusted branches. Both are now wrong, and the second is a live safety hole.

- Both Cloudflare deploy commands are now `pnpm run cf:deploy:preview`, which
  runs `narduk-app deploy versions-upload`: it uploads a version that serves no
  traffic. A production command that deploys puts a `main` push straight into
  production, which is the one thing the standard exists to prevent. The doc
  says why the two are the same command and that the name is historical.
- Non-production branch builds now start **disabled**. A version captures its
  binding _configuration_ but not the state behind it, and `preview_database_id`
  / `preview_id` / `preview_bucket_name` apply to `wrangler dev` only, so a
  branch build of an app that binds production D1, KV or R2 reads and writes
  production data from every pull request. The doc states the hazard and the
  exit from it: create a preview resource per binding, list them under
  `deployment.previewBindings`, then turn branch builds on.
- The runbook now carries the exact `deployment` block to paste into
  `Config/cloudflare-app.json` at onboarding, plus the promote, live-proof and
  rollback commands.
- A new `foundation:deployment` script runs
  `narduk-app foundation:check:deployment --checkout ..`.

The generator still does not create `Config/cloudflare-app.json` itself. That
file records live Cloudflare facts a checkout cannot know, onboarding owns it,
and this generator does not hold a continuing relationship with an app's
configuration. It emits the block to paste and a check that reads it.

## Review round 1

The `deployment` block the runbook tells a new app to paste was ~24 hand-typed
string literals, and the only assertions on it were substrings. Adding one
required key to the schema would have shipped a generator whose paste-this block
fails the very check it tells you to run — discovered by the first app to try
it, not by CI. The block is now serialized from a single object, and the
generator test extracts the fenced block, parses it, and asserts it equals
`narduk-app-tools`' committed `fixtures/default-deployment-block.json` — which
that package's own suite pins to `defaultDeploymentBlock()` and to
`readDeploymentBlock` accepting it. The pin is a fixture rather than an import
because the published generator must require nothing at runtime, and because
CI's per-package gates run `pnpm --filter <name>` without building a workspace
sibling's `dist`. Add a required key to the schema and `narduk-app-tools` goes
red; update its fixture and this generator goes red until it emits the new
block.
