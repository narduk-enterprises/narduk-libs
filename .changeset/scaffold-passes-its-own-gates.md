---
'@narduk-enterprises/create-narduk-app': minor
---

feat(create-narduk-app): a fresh scaffold reaches a green first CI run

Six independent defects sat between `create-narduk-app` and a green `main`, and
four were invisible until after the first push (narduk-libs#617).

**The scaffold failed the gate its own CI runs.** Generated CI calls the shared
workflow with `foundation-check: true`, which fails the build on `FAIL` _or_
`UNKNOWN`. A fresh scaffold produced a decided FAIL on item 1.2 —
`apps/web/wrangler.jsonc` exists but `Config/cloudflare-app.json` does not —
plus UNKNOWNs on 1.4/3.1/3.2 for want of `access.exposureClass`, and a FAIL on
1.1 once a build had run. The first CI run of every new app was red by
construction and nothing inside the app could fix it. The generator now emits
`Config/cloudflare-app.json`: schema version, product, worker, `access`
(`public` or `authenticated-public`, from `--exposure`) and the bindings mirror.
What it cannot know — `product.repository`, the account id, domains, the
narduk-v1 `deployment` block — is absent rather than fabricated, the same rule
`wrangler.jsonc`'s missing `account_id` already followed. Absent leaves the app
NOT ADOPTED for deployment, which is the truth before onboarding.

**`quality:static` was weaker than the gate that judges it.** It called `build`,
where CI calls `build:ci`; on any `seo` app `build` throws on an empty
`NUXT_OG_IMAGE_SECRET`, so the local gate went red where CI was green. It now
builds with the script CI builds with.

**The scaffold failed its own `quality:static` three ways.** Long free text — a
display name, a description, a site URL — pushed `const X = '…'` past the
generated Prettier `printWidth: 100`, so `format:check` failed on the
generator's own output; the emitter now breaks those declarations exactly where
Prettier breaks them, and the e2e heading assertion binds its name to a const so
that line is fixed-width at any input length. `knip` reported `narduk-logging`
(reached through `runtimeConfig`, no named import) and `eslint` (backing
`narduk-lint` and `eslint.config.mjs`) as unused; both are now declared ignores.

**`xaiApiKey` leaked into apps without the `ai` capability.** It was emitted
unconditionally into `runtimeConfig`. `narduk-ai` declares that key itself with
a validator, and under `defu` an app-side `''` is a defined value that _wins_ —
so the line both advertised a key to capability sets that never asked for one
and defeated the module's own validation for the sets that did. Removed.

**The generated README now names the three gates** — `quality:static`
(credential-free, offline, what you run), `foundation:check` (reads the
registry, exits 2 on UNKNOWN, deliberately not chained), `quality` (adds the
browser suite) — and, for a private app, warns before the first push that CI
runs on self-hosted manifest-routed runners: without runner-group membership the
first workflow run sits `queued` indefinitely with no error, no timeout and no
log.

A new end-to-end test in `narduk-app-tools` runs the real `foundation:check`
against a real generated app, before and after a build, and asserts `PASS` with
zero unknowns — the claim nothing in this repository previously made.
