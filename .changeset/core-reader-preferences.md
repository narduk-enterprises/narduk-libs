---
'@narduk-enterprises/narduk-core': minor
---

Add the reader preference store and its formatters: `usePreferences()`,
`useFormatters()`, and the pure functions underneath them. An app stores
measurements in SI and displays them in whatever the reader asked for, one call
site at a time — nothing here rewrites existing display code and nothing is
global.

**One cookie, `ne_prefs`**, carries units, time zone and locale as a small
versioned parameter string (`v=1&u=imperial&tz=America%2FChicago&l=en-US`). It
is read during SSR, so there is no client-only flash of the wrong unit, and it
is validated on read: a future schema version, a truncated or hand-edited value,
an unknown time zone, or something that is not a parameter string at all decodes
to no selection and the documented defaults apply. A bad cookie is never a 500,
and a cookie with one bad field keeps its good ones. Unset, `locale` comes from
`Accept-Language` (`en-US` when absent), `units` is imperial for a `US` region
and metric otherwise, and `timeZone` is `UTC`.

**Hydration is the contract, not a hope.** Server and client read the same two
inputs — the cookie, and defaults the server resolved once and carried in the
Nuxt payload — so the first client render reproduces the server's markup
exactly. The browser's time zone is the one input the server cannot have, so it
is adopted _after_ mount rather than guessed during render. The proof renders
with `renderToString`, hydrates that markup with a real
`createSSRApp().mount()`, and fails on a Vue hydration warning; its control case
reproduces the naive implementation and requires the warning to appear.

**Cache safety.** Reading preferences during SSR marks the response, and a
marked response is forced to `private, no-store` with `Vary: Cookie` — by
`setCacheProfile` (new `preferences-cookie` suppression reason) for a route that
sets its own posture, and by the new `preferences-cache` Nitro plugin for the
rendered SSR document. Nothing downgrades a response that never read
preferences, so existing app cache profiles are unchanged.

**The formatters** are standalone pure functions over SI inputs, so importing
one does not ship the rest: `formatDistance`, `formatSpeed`,
`formatTemperature`, `formatHeight`, `formatLength`, `formatPressure`,
`formatDecimal`, and the timezone-aware `formatZonedDate` / `formatZonedTime` /
`formatZonedDateTime`. `null`, `undefined`, `NaN`, `Infinity` and an unparseable
date all render an em dash rather than `NaN ft`. `timeZone` and `locale` are
arguments with fixed fallbacks, never the host's. No new dependency: `Intl` does
the work, including every daylight-saving transition date.
