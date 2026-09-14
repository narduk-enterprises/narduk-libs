# software-delivery — component-usage survey (L6)

SHA `7360b97` on `main`. **Not a Nuxt app** (`is_nuxt_app: false`).

Pure Cloudflare Worker: `wrangler dev`/`wrangler deploy` scripts,
`src/index.ts` + `src/index.test.ts`, a `redirect-worker/` sub-worker, one
static asset (`public/og.png`). No `nuxt.config.*` anywhere, no `nuxt`
dependency in `package.json`, and zero `.vue` files in the entire repo
(`find . -maxdepth 6 -name '*.vue' -not -path '*/node_modules/*' | wc -l` → 0).

README/scripts (`upload:catalog`, `upload:release`, `upload:myfarm`) indicate
this is an app-catalog / release-delivery backend service (uploads release
artifacts, e.g. for `my-farm`), not a UI surface. No component-usage patterns to
survey; excluded from further analysis per the lane brief's instruction for a
non-Nuxt repo.
