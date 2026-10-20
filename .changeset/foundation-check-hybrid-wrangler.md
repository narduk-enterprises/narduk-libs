---
'@narduk-enterprises/narduk-app-tools': patch
'@narduk-enterprises/create-narduk-app': patch
---

`foundation:check` reads the Nuxt app's own wrangler config. In a hybrid repo (a
data-plane Worker's `wrangler.jsonc` at the repo root, the Nuxt app under `web/`
or `apps/web/`), item 1.2 and the other items that resolve the app's wrangler
config now judge `web/wrangler.jsonc` against the web app's
`Config/cloudflare-app.json`, instead of demanding the root Worker's bindings
there. A Nuxt app with no wrangler config of its own still falls back to the
first config at a known path (narduk-libs#1967).
