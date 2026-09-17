---
'@narduk-enterprises/narduk-core': patch
---

Sanitize production 5xx payloads before Nuxt serializes them into
`__NUXT_DATA__`, and reject oversized CSP report bodies with 413.

Nitro's prod handler only redacts `message`/`data` when `unhandled` or `fatal`
is set. Vue SSR wraps the throw as a handled H3Error, so the raw message still
reached the client. A prepended Nitro error handler now genericizes 5xx when
`previewSafeMode` is off, without replacing Nuxt's renderer. `nuxt dev` skips
the sanitizer (`import.meta.dev`) so local 5xx still show the original payload.
A string `statusCode` such as `"404"` is coerced before the 5xx decision, so 4xx
`data` still reaches clients; a string that does not name a real HTTP status
(`"-1"`, `"0"`, `"404abc"`) falls back to 500 and is sanitized. The CSRF-exempt
CSP report sink now refuses bodies over 64 KiB before parse.
