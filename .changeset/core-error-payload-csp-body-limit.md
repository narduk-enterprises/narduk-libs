---
'@narduk-enterprises/narduk-core': patch
---

Sanitize production 5xx payloads before Nuxt serializes them into
`__NUXT_DATA__`, and reject oversized CSP report bodies with 413.

Nitro's prod handler only redacts `message`/`data` when `unhandled` or `fatal`
is set. Vue SSR wraps the throw as a handled H3Error, so the raw message still
reached the client. A prepended Nitro error handler now genericizes 5xx when
`previewSafeMode` is off, without replacing Nuxt's renderer. The CSRF-exempt CSP
report sink now refuses bodies over 64 KiB before parse.
