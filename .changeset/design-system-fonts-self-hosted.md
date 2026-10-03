---
'@narduk-enterprises/narduk-core': minor
'@narduk-enterprises/status-runtime': major
'@narduk-enterprises/create-narduk-app': patch
---

Self-host the design-system fonts instead of linking Google Fonts
(narduk-libs#1366). narduk-core now declares Instrument Sans
(400/500/600/700) and IBM Plex Mono (400/500/600) to `@nuxt/fonts` for any app
that loads the `narduk-ui` tokens or the `narduk-shell` theme, with
`global: true` because both sheets set the families through custom properties
(`--ns-font-text`, `--ns-font-mono`, `--ne-font-sans`, `--ne-font-mono`) that
`@nuxt/fonts` does not scan. The files ship same-origin from `/_fonts/`; an
app's own `fonts.families` entry for a family wins by name. No local override
is needed any more.

status-runtime (major): `designSystemFontLinks` was a render-blocking
`fonts.googleapis.com` stylesheet plus two preconnects, about 900 ms of mobile
first paint on riverstat.us. It stays exported so a spread keeps building, but
is deprecated and always empty. Upgrade narduk-core to this release in the same
change as status-runtime, or the app renders the system fallback faces. An app
that spreads the export can delete the spread; one that declared the two
families locally (riverstatus) can delete that block.

create-narduk-app: pin the new narduk-core.
