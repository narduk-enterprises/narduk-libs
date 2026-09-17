# `narduk-app e2e-serve`

Shared prebuilt-Worker launcher for Playwright. The estate `nuxt-cloudflare`
callable sets `E2E_PREBUILT_ARTIFACT=1` and assumes every narduk-app has a
launcher; this command is that launcher (narduk-libs#447, lifted from Buoys
`serve-e2e-build.mjs` and the buoys#124 workerd client-abort filter).

## Command

```sh
narduk-app e2e-serve <port> [--entrypoint <file>] [--config <file>] \
  [--assets <dir>] [--cwd <dir>]
```

| Input          | Default (narduk-app layout)                       |
| -------------- | ------------------------------------------------- |
| `<port>`       | required, integer 1–65535                         |
| host           | `127.0.0.1` (`E2E_HOST` must be that or unset)    |
| `--entrypoint` | `<app>/.output/server/index.mjs`                  |
| `--config`     | `<app>/wrangler.jsonc` or `<app>/wrangler.json`   |
| `--assets`     | `<app>/.output/public` when that directory exists |
| `--cwd`        | process cwd; app dir is `cwd` or `cwd/apps/web`   |

`<app>` is the directory that holds the Wrangler config (`resolveAppDir`).

`NUXT_*` and `NITRO_*` environment variables present on the process are
forwarded as plain-text Worker bindings so Playwright `webServer.env` test
secrets reach the isolate. Do not put real secrets in those names.

## What it will not do

- Build or watch. If the entrypoint is missing it exits with
  `Prebuilt Worker artifact not found: … e2e-serve will not build a fallback.`
- Bind anything other than `127.0.0.1`.
- Depend on a `wrangler` install inside this package. Resolve wrangler from the
  app; if it is missing the process prints exactly
  `wrangler is not installed in this app. Add it as a dependency and retry.`

## Startup notes

Playwright copies only stderr from a `webServer` child. The launcher writes:

```text
[e2e-serve] cwd=…
[e2e-serve] entrypoint=…
[e2e-serve] server output: N files, X.Y MiB
[e2e-serve] calling unstable_startWorker
[e2e-serve] worker constructed; awaiting ready
[e2e-serve] ready on http://127.0.0.1:<port>
```

and `[e2e-serve] still starting the worker...` every 15s until ready. Do not set
Playwright `webServer.stderr: 'ignore'` — that would drop the heartbeat too.

## workerd client-abort filter

A multi-route `page.goto` aborts in-flight Worker responses. workerd logs:

```text
✘ [ERROR] kj::getCaughtExceptionAsKj() = kj/async-io-unix.c++…: disconnected: ::write(…): Broken pipe
  stack: …workerd@…
```

That block (including esbuild blank-line wrapping and Playwright's `[WebServer]`
prefix) is swallowed. Every other `✘ [ERROR]`, and a `Broken pipe` that is not
the `::write` disconnect form, still prints. A following `ECONNREFUSED` is the
real crash
([cloudflare/workers-sdk#15202](https://github.com/cloudflare/workers-sdk/issues/15202)).

The filter is the Buoys function from `fix/e2e-workerd-epipe-filter`
(buoys#124). Do not write a second one.

## Scaffold and adoption

`create-narduk-app` emits a `playwright.config.ts` that runs this command when
`E2E_PREBUILT_ARTIFACT=1` and `nuxt dev` otherwise. Existing apps replace their
`apps/web/scripts/serve-e2e-build.mjs` copy after this package is published.
