# Narduk Libs Agent Guide

This repo owns the reusable published packages and focused one-shot tooling used
by Narduk Cloudflare/Nuxt apps. It is not a fleet template and must never create
a continuing sync, reconcile, drift, or control-plane relationship with apps.

## Scope

- Shared Nuxt modules, runtime helpers, test helpers, focused app-local tooling,
  and the deterministic one-shot app generator live in four families under
  `packages/`: `modules/` (Nuxt runtime modules and layers), `tooling/` (build,
  test and generator tooling), `design/` (the coded NE design system) and
  `contracts/` (shared contracts). The layout is company-hq `D-WEBFOUND-2` Q2
  (a); `pnpm-workspace.yaml` is the single source of truth for where a package
  lives, so scripts resolve package directories from it rather than assuming
  `packages/<name>`.
- The app generator may create a new repository layout once. It must not manage
  that repository afterward and must not call Command, Cloudflare, GitHub, or
  Doppler directly.
- Fleet sync, starter reconciliation, drift enforcement, registry mutation, and
  central deployment orchestration stay out of this repo.
- Keep package changes source-compatible for existing fleet apps unless the user
  explicitly approves a breaking release.

## Workflow

- Preserve unrelated local changes.
- Make narrow package changes and validate the touched packages before publish.
- Do not commit token-bearing files such as `.npmrc.auth`.
- Publish package versions from this repo only after build/pack validation.

## Library-first fixes

- When a fleet app exposes a bug in shared auth, runtime, Cloudflare, Nuxt, SEO,
  analytics, upload, D1, KV, R2, or deployment behavior, default to fixing it in
  the owning package here.
- App-local papering over is a temporary exception, not the normal path. It
  needs a clear written justification, a narrow blast radius, and a follow-up
  plan to remove it after the library fix ships.
- Do not let one app quietly fork shared behavior unless the app has a genuine
  product-specific requirement that does not belong in the reusable package.

## Validation

- `pnpm install`
- `pnpm run quality`
- `pnpm run surface:check` (inside `quality:artifacts`): every component
  `narduk-shell` registers, and every `./format` export, has a README section,
  tests and a design card shipped beside it. Failures print the exact fix; see
  `packages/design/narduk-shell/README.md` § "Component surface check".
- For a touched package, also run its focused typecheck/unit tests and
  `pnpm pack --dry-run` before publication.
- New package releases must be installable from their packed artifact by a
  consumer fixture outside the workspace.
