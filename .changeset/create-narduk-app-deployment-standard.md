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
