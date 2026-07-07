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

Publishing uses GitHub Packages. Use a temporary npm config or Doppler-provided
token material; do not commit auth files.
