---
"@narduk-enterprises/create-narduk-app": patch
---

Default the local `siteUrl` (used whenever `--site-url` is omitted) to
`http://127.0.0.1:<port>` instead of `http://localhost:<port>`.
`nuxt-site-config` (pulled in transitively by the `seo` capability) flags a
`localhost` hostname as an invalid site URL and can resolve
`useSiteConfig().url` to a different host than the literal `siteUrl` the
generator wrote everywhere else (`nuxt.config.ts`'s `site.url`,
`Config/social-previews.json`, the runtime `public.siteUrl`). That split made
every fresh `--capabilities seo` (or default-capabilities, once
`@narduk-enterprises/create-narduk-app`'s `seo,analytics` default applies)
scaffold's rendered `og:image` mismatch its own `Config/social-previews.json`
default, failing `social-previews.spec.ts`'s default-route check
(`Default route did not select defaultImage.path`) in every new app's own
CI, independent of any other capability or config choice. `127.0.0.1` carries
the same "local dev" meaning without tripping that check.

Patch, not minor: this only changes the *unconfigured* local-dev default,
which is not meant to be relied on past `narduk-app deploy` (every deployed
app has a real `--site-url`), and no public API/CLI surface changed.
