# Narduk Libs Agent Guide

This repo owns the reusable published packages used by Narduk Cloudflare/Nuxt
apps. It is intentionally not an app starter and not the fleet template.

## Scope

- Shared Nuxt modules and runtime helpers live in `packages/*`.
- Template scaffolding, app generation, and starter sync stay out of this repo.
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
- `pnpm run build`
- `pnpm run typecheck`
- `pnpm -r --filter './packages/*' --if-present test:unit`
