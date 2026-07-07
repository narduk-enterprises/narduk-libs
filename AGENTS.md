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

## Validation

- `pnpm install`
- `pnpm run build`
- `pnpm run typecheck`
- `pnpm -r --filter './packages/*' --if-present test:unit`
