# @narduk-enterprises/status-runtime

Shared build-time configuration for the five status applications. Everything
here was duplicated verbatim across app `nuxt.config` files before extraction.

- `resolveSourceRevision(env?)` — the exact source revision a build is produced
  from, resolved in a fixed precedence so an authorized exact-SHA release always
  stamps the SHA it was authorized for.
- `designSystemFontLinks` — the design system's single two-family font request.
- `designSystemThemeColor` — `--ns-ink`, for `<meta name="theme-color">`.

## Publication

Published from `narduk-libs` to GitHub Packages under `@narduk-enterprises`.
This package is a dependency-free ESM module with no build step. Pin an exact
version; never use a path or monorepo workspace protocol dependency.

Keep it split-survivable: do not add monorepo-relative imports, and do not put
app-specific logic here. Pair it with `@narduk-enterprises/narduk-ui` for the
token and instrument surface.

Anything generic to every Narduk app rather than to these five specifically
belongs upstream in `@narduk-enterprises/narduk-core`, not here.
