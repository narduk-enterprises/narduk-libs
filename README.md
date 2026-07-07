# narduk-libs

Reusable Narduk packages published under `@narduk-enterprises/*`.

This monorepo is the home for the app libraries that production fleet apps
import directly. It replaces the old physical dependency on `narduk-template`
for package development while preserving the template history in the apps that
came from it.

## Packages

- `@narduk-enterprises/narduk-platform`
- `@narduk-enterprises/narduk-core`
- `@narduk-enterprises/narduk-auth`
- `@narduk-enterprises/narduk-seo`
- `@narduk-enterprises/narduk-analytics`
- `@narduk-enterprises/narduk-uploads`

## Commands

```sh
pnpm install
pnpm run build
pnpm run typecheck
pnpm run test
```

## Fix Policy

Fleet app bugs that come from shared auth, runtime, Cloudflare, Nuxt, SEO,
analytics, upload, D1, KV, R2, or deployment behavior should be fixed in the
owning package. App-local workarounds must be explicitly justified, scoped, and
tracked for removal once the library fix is available.

Publishing uses GitHub Packages. Use a temporary npm config or Doppler-provided
token material; do not commit auth files.
