---
'@narduk-enterprises/narduk-app-tools': minor
---

Add
`narduk-app foundation:check:security-headers --base-url <url> [--path <p>]...`,
a live probe of a deployment's security response headers for narduk-core's
`security.headers` preset.

It reports, per probed route, whether a Content-Security-Policy is enforcing,
report-only, or absent; whether the policy actually in force uses a nonce rather
than `'unsafe-inline'` / `'unsafe-eval'`; and whether
`Strict-Transport-Security`, framing restriction, `Referrer-Policy`,
`Permissions-Policy` and `X-Content-Type-Options` are present — each proven, a
gap, or unknown.

Unlike items 1-8 this one has no filesystem verdict. A response header is
produced by a running server and a checkout can describe a policy it does not
serve, so no `--base-url` means `unknown` (exit 2), never `pass`. It is a
separate command and one-item artefact
(`tool: '@narduk-enterprises/narduk-app-tools/security-headers'`) for the same
reason `foundation:check:shared-ui-pinned` and `foundation:check:coverage` are:
`foundation-check.json` is the ratified 7-item contract company-hq
`check-web-foundation.py` validates, and an `id` outside `1..7` is a rollup-red
F3 ARTEFACT finding. No registry credential is required.
