---
'@narduk-enterprises/narduk-core': minor
---

Add the opt-in `security.headers` preset, which wraps `nuxt-security` with
estate defaults: a nonce-based Content-Security-Policy,
`Strict-Transport-Security`, `form-action`, `upgrade-insecure-requests`, a
violation report route that logs through narduk-logging at `warn`, and a per-app
allowlist for the `script`, `connect`, `img`, `font`, `style`, `frame`, `worker`
and `media` directives.

narduk-core already served security headers on every app taking the module's
default `server: true` — `runtime/server/middleware/securityHeaders.ts` is
picked up by `addServerScanDir`, and production Buoys was verified on 2026-09-17
serving an enforcing CSP, `X-Frame-Options`, `Referrer-Policy`,
`Permissions-Policy` and `X-Content-Type-Options`. The gaps this closes are
HSTS, the nonce (the legacy `script-src` carries
`'unsafe-inline' 'unsafe-eval'`), a report-only soak path, a violation sink, and
a module-level allowlist.

The preset is additive, and the default is `off`, so **upgrading changes no
app's headers**. With `enabled: true` the legacy enforcing CSP keeps being
served and the strict nonce policy soaks beside it as
`Content-Security-Policy-Report-Only`; `enforce: true` promotes the strict
policy and retires the legacy one. Serving both during the soak is what avoids
downgrading an already-enforcing app to report-only.

`nuxt-security` is an **optional peer dependency**: an app that never enables
the preset installs nothing extra. It was chosen over a hand-rolled Nitro
handler because it is maintained (2.6.0, 2026-05-12, MIT), targets Nuxt 4 via
`@nuxt/kit ^4`, and its runtime imports no Node builtin, using only
`crypto.subtle`, `crypto.getRandomValues`, `btoa` and `TextEncoder` — all
workerd APIs. Its non-header features (`csrf`, `corsHandler`, `rateLimiter`,
`xssValidator`, `requestSizeLimiter`, `allowedMethodsRestricter`, `basicAuth`)
are all disabled, as are `removeLoggers` and `sri`, which upstream defaults on
and which change bundle and build behaviour a headers preset has no business
changing.
