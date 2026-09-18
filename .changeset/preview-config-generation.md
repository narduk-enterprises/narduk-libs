---
'@narduk-enterprises/narduk-app-tools': minor
'@narduk-enterprises/create-narduk-app': patch
---

Make `deployment.previewBindings` real, so item 12.4 can pass with
non-production branch builds on (narduk-libs#473, deployment-standard design
§3.3 option A).

**The build now isolates a preview.** A `previewBindings` entry may name its
preview resource with wrangler's own fields: `id` for KV, `database_id` and
`database_name` for D1, `bucket_name` for R2. On a Workers Build whose
`WORKERS_CI_BRANCH` is not `productionBranch`,
`narduk-app deploy versions-upload` writes `.wrangler.deploy.preview.json` with
every D1, KV and R2 binding rebound, and uploads with it. The rebinding is all
or nothing. When any binding lacks its preview resource, or names a production
one, the build keeps `.wrangler.deploy.production.json` exactly as before and
prints a `WARNING`. `deploy`, the production branch, runs outside Workers
Builds, an explicit `--env` target and apps without a valid `narduk-v1` block
are unchanged.

**12.4 checks the config the build would upload.** It runs the same planner
against the app's own wrangler config.

- It reports `pass` when every binding is rebound to a resource that is not a
  production one.
- It reports `fail` when a preview entry names no binding of its kind, or when a
  preview id, name or bucket is a production one in any scope.
- It stays `unknown` for bare names, a D1 entry missing its id or name, a TOML
  app config, or bindings in a second Worker's config.

The artefact gains `previewConfig`, and the summary prints a `preview` line.

`create-narduk-app` adds `.wrangler.deploy.preview.json` to the generated
`.gitignore` and `.prettierignore`.
