# @narduk-enterprises/status-runtime

Legacy build-time helpers retained for existing consumers. The special
status-app compliance category was retired by company-hq D-WEBFOUND-2's
2026-09-16 amendment; this package is optional, not an app foundation requirement.
It remains published and source-compatible. Migrate existing uses during normal
app maintenance, preserving their fonts and revision behavior.

This package has no health endpoint and no Nuxt module. It can render a public
status page from a narduk-core `/api/health` body that the app already serves.

- `resolveSourceRevision(env?)` — the exact source revision a build is produced
  from, resolved in a fixed precedence so an authorized exact-SHA release always
  stamps the SHA it was authorized for.
- `designSystemFontLinks` — the design system's single two-family font request.
- `designSystemThemeColor` — `--ns-ink`, for `<meta name="theme-color">`.
- `parseHealthEnvelope(body)` — reads the narduk-core health envelope
  (`{ success: true, data }`) or the inner `data` object.
- `renderStatusPage(body, { appName? })` — opt-in public HTML for `/status`:
  overall status, per-check results, and freshness per data product. No auth
  UI. Apps mount it; nothing is auto-injected.

## Publication

Published from `narduk-libs` to GitHub Packages under `@narduk-enterprises`.
This package is a dependency-free ESM module with no build step. Pin an exact
version; never use a path or monorepo workspace protocol dependency.

Keep it split-survivable: do not add monorepo-relative imports, and do not put
app-specific logic here. Adopting it does not require `@narduk-enterprises/narduk-ui`.

New apps use the normal web-app contract: `narduk-core` owns build stamps and
health behavior, while app font and theme choices remain app-owned.
