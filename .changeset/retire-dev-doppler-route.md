---
'@narduk-enterprises/narduk-app-tools': minor
'@narduk-enterprises/create-narduk-app': patch
---

Retire the implicit Doppler execution in `narduk-app dev` (narduk-libs#321).

**Breaking for existing callers of `narduk-app dev`.** The command used to run
every child through `doppler run`, with `--project` / `--config` selecting a
Doppler project and config — an implicit dependency on the retired app-secret
store. It now runs one child process through an explicit credential route:

- no `--credentials` (the default) runs the child directly, so an app whose
  local development needs no secrets has no secret-store dependency at all;
- `--credentials nvault` requires a complete `--project` / `--environment` /
  `--config` selector and runs
  `nvault run -p <project> -e <environment> -c <config> -- <command>`, the
  registered local credential route, whose values stay process-local (company-hq
  `docs/SECRETS-MATRIX.md`, plane 4);
- `--dry-run` prints the resolved command without running it.

The retired invocation
`narduk-app dev --project <app> --config dev -- <command>` now fails with a
message naming both replacements, rather than silently starting a dev server
without the environment it used to receive. `--credentials doppler` fails the
same way. Doppler `ne/*` root provisioners remain a separately approved
provider-root exception and are not an application development credential
source.

The exported `buildDopplerRunArgs` is replaced by `buildNvaultRunArgs`,
`buildDevInvocation` and `formatDevInvocation`.

Generated apps start Nuxt directly: the web `dev` script is now
`nuxt dev --host 127.0.0.1`, and the generated README documents the nvault route
an app adopts when it later needs credentials locally. `narduk-app deploy-local`
is a different command and still reads Doppler `narduk/tokens`; it is unchanged.
