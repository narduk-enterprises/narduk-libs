# Running a MapKit map locally

A runbook for getting a real Apple map on a local `nuxt dev` server, for agents
and people. Last proven on 2026-10-24 on Buoys (`9fd9017`, narduk-mapkit 3.0.1):
token route `200` and a rendered map on both `http://127.0.0.1:<port>` and
`http://localhost:<port>`.

## The short version

```sh
narduk-app dev --mapkit -- nuxt dev --host 127.0.0.1
```

or, with any `narduk-app-tools` version:

```sh
nvault run -p apple -e prd -c mapkit-signing -- pnpm dev
```

Then open the page the dev server prints and check the map draws. That is the
whole setup on narduk-mapkit 2.1 or later. Everything below is for when it
doesn't work.

## Why it stopped "just working"

Local maps used to work with a bare `pnpm dev`. Two changes broke that, and
nothing replaced the step that used to make it work:

1. **The dev wrapper stopped injecting the Apple key.** Before narduk-app-tools
   0.4.0 (narduk-libs#321, merged 2026-09-16 in #328),
   `narduk-app dev --project <app> --config dev` meant `doppler run`, and the
   app's Doppler config carried `APPLE_*`. Doppler app projects are retired, and
   that invocation now exits with "narduk-app dev no longer runs Doppler". Apps
   whose `dev` script is plain `nuxt dev` never received the key at all. So
   today a bare `pnpm dev` gets a `503 unconfigured` from the token route, and
   on the Doppler-era scripts it does not start at all.
2. **The token route became same-origin only.** From narduk-mapkit 2.1.0 (#431,
   2026-09-17) the route mints a token for exactly the origin that served the
   request and refuses everything else. `MAPKIT_ALLOWED_ORIGINS`, `MAPKIT_TOKEN`
   and `APPLE_MAPKIT_TOKEN` are ignored. The opt-in `nardukMapKit.allowedHosts`
   list (#437, 2026-09-23) _is_ enforced, so a list that names only production
   hosts refuses the dev server.

## Step by step

### 1. Prove the credential route works

```sh
nvault run -p apple -e prd -c mapkit-signing -- sh -c \
  'for n in APPLE_TEAM_ID APPLE_KEY_ID APPLE_PRIVATE_KEY; do eval "v=\${$n:-}"; [ -n "$v" ] && echo "$n set" || echo "$n MISSING"; done'
```

All three should print `set`. This prints names, never values. If nvault fails,
it is an nvault authentication or install problem, not a MapKit one. A cloud
container without nvault cannot sign MapKit tokens: use the `/testing` fake (see
"Tests" below), not a real map.

### 2. Start the dev server under that route

- An app on narduk-app-tools with `--mapkit` (this change onward):
  `narduk-app dev --mapkit -- nuxt dev --host 127.0.0.1`.
- Any app: `nvault run -p apple -e prd -c mapkit-signing -- pnpm dev`.
- An app that also needs its own secrets nests the two routes, as the estate's
  `ship` scripts already do:
  `narduk-app dev --mapkit -- nvault run -p <app> -e <env> -c <config> -- nuxt dev --host 127.0.0.1`.
  The MapKit persona is one config; it does not replace an app's old Doppler
  `dev` config, which may have carried other secrets.

If `pnpm dev` dies with "narduk-app dev no longer runs Doppler", the app's
script is still the Doppler-era `narduk-app dev --project <app> --config dev`.
Run one of the commands above directly and fix the script in the app's repo.

### 3. Probe the token route

```sh
curl -s -o /dev/null -w '%{http_code}\n' \
  -H 'Sec-Fetch-Site: same-origin' http://127.0.0.1:3000/api/mapkit-token
```

Swap in your port and `tokenRoutePath` if the app changed them. The
`Sec-Fetch-Site` header matters: the route refuses a request with no same-origin
evidence, so a bare `curl`, or opening the URL in a browser tab, gets a `403` by
design. Neither is a setup fault.

| Answer | Meaning                                                      | Fix                                                                                                                                                                                               |
| ------ | ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `200`  | Signing works for this origin                                | Go to step 4                                                                                                                                                                                      |
| `503`  | `APPLE_TEAM_ID`, `APPLE_KEY_ID` or `APPLE_PRIVATE_KEY` unset | The server was not started under step 2. The dev console names the missing variables.                                                                                                             |
| `403`  | Not same-origin, or the host is not on `allowedHosts`        | Send the header above. If the app sets `nardukMapKit.allowedHosts`, add the dev `host:port` (for example `'127.0.0.1:3000'`) beside its production hosts. The dev console names the refused host. |
| `500`  | The key did not sign                                         | `APPLE_PRIVATE_KEY` must be PKCS#8 PEM (`BEGIN PRIVATE KEY`). See "Stale values" below.                                                                                                           |
| `404`  | No route at this path                                        | Check `nardukMapKit.tokenRoute` and `tokenRoutePath`, and that the app registers `@narduk-enterprises/narduk-mapkit/nuxt`.                                                                        |

From the narduk-mapkit release after 3.0.1, the route also prints a one-line fix
with a link to this page in the dev server's console the first time it answers
`503`, `500`, or `403` for a loopback host.

### 4. Check the map in a browser

Open the app page that shows a map. Some apps (Buoys) defer the map behind a
"Show the live map" button. A working map shows Apple's tiles and the "Maps"
wordmark. In the browser console:

- `Origin does not match - expected: X, actual: Y` means Apple rejected a token
  minted for another origin. The page and the token route were served from
  different origins: a proxy, a tunnel, or a page on one port calling a route on
  another. Browse the dev server directly.
- A CSP error naming `cdn.apple-mapkit.com` or `wasm-unsafe-eval` is a
  Content-Security-Policy problem, not a credential one. See the README,
  "Content-Security-Policy".

`127.0.0.1` and `localhost` both work on 2.1 or later, because the token is
minted for whichever origin served the page. An older note said to avoid
`localhost`. That predates 2.1 and no longer holds.

## Stale values beat nvault

The Nuxt route reads Cloudflare bindings before `process.env`. Under
`nitro-cloudflare-dev`, `wrangler.json(c)` `vars` and `.dev.vars` are those
bindings. A non-empty `APPLE_*` there wins over what nvault injected. If the
probe answers `500`, or signs with the wrong team, look in those files for
`APPLE_` names. Do not put the key in `.dev.vars`; remove the stale value and
let nvault supply it.

## Apps on the frozen 2.0.x adapter

`@narduk-enterprises/narduk-mapkit-nuxt` 2.0.x (pacc-trac-live,
narduk-family-location, and apps generated with the `mapkit` capability as of
this writing) still treats `MAPKIT_ALLOWED_ORIGINS` as a real allowlist. If
`wrangler.json(c)` sets it to production origins only, the dev server gets
`403`. Put the loopback origins in an untracked `.dev.vars`
(`MAPKIT_ALLOWED_ORIGINS=http://127.0.0.1:3000,http://localhost:3000`). On 2.1
or later the variable does nothing and can be deleted.

## Tests

End-to-end and unit tests should not sign real tokens. Use
`@narduk-enterprises/narduk-mapkit/testing`, a deterministic MapKit JS fake that
needs no network, no Apple key and no canvas (README, "Testing: the MapKit
fake"). A credential-less dev server is expected to answer `503`. Tests that
tolerate only that `503` are correct.
