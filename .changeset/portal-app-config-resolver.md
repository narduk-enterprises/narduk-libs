---
'@narduk-enterprises/narduk-app-tools': minor
'@narduk-enterprises/create-narduk-app': minor
---

`Config/cloudflare-app.json` and `Config/project-lifecycle.json` now resolve through one shared resolver, because the Operator Portal's app row owns that configuration (D-PORTAL-APP-CONFIG-1) and the per-repo copies are being deleted. `NARDUK_APP_CONFIG_SOURCE` is `auto` (the default: the checkout's file when it has one, exactly as before, else the portal's copy), `file` (the file only) or `portal` (ignore any file). The portal copy is read from `GET /api/estate/app-config?repo=<owner>/<repo>&file=<file>` with the `producer:app-config-read` key in `OPERATOR_PORTAL_APP_CONFIG_TOKEN`; the origin is `OPERATOR_PORTAL_URL`, default `https://ops.nardukenterprises.com`. The token is read from the environment only and scrubbed from every error. `contractOwnership` accepts `portal-owned` and, during the transition, `app-owned`.

A repository that still carries the files behaves identically and never touches the network. When neither source resolves, the commands fail with one `AppConfigError` instead of degrading: `deploy` no longer uploads a branch build with production bindings, the database-ownership guard behind `db migrate` no longer switches itself off, and waivers are no longer dropped. No token, a 401, a 503 or a timeout never reads as an absent file. A repository without the files and without a token must now set `NARDUK_APP_CONFIG_SOURCE=file` (a checkout that has neither file, such as a Coolify app) or provide the key.

Converted readers: `manifests validate`, `deploy` (`versions-upload` on a Workers Build branch), `ship`, `db create`, `db migrate-deployment`, `db bundle`, `db migrate`/`status` (the ownership guard), `foundation:check`, `foundation:check:deployment`, `doctor --adoption` (waivers) and `doctor --all`. Programmatic callers resolve first with `primeAppConfig` / `primeAppCheckoutConfig` / `primeDeployAppConfig`; `runFoundationCheck`, `runAdoptionCheck` and `runShip` do it for you.

`create-narduk-app` no longer writes `Config/cloudflare-app.json` for a new app (it never wrote `Config/project-lifecycle.json`). The generated docs say the declaration lives on the portal app row, and the generated `validate-manifests.mjs` says so instead of comparing against a file that is not there.
