# @narduk-enterprises/narduk-tenancy

## 0.2.1

### Patch Changes

- 37c03e2: Publish the server-only module package Nuxt config fragment once as
  `@narduk-enterprises/narduk-core/nuxt-module-package-config`, and consume it
  from `narduk-tenancy`. A `packages/modules/*` package that ships no `app/`
  tree and sets no explicit `srcDir` keeps the package root as srcDir, so
  `nuxt typecheck` otherwise pulls `eslint.config.mjs` and the untyped `.mjs`
  sources of `@narduk-enterprises/eslint-config` into the type project
  (narduk-libs#176).

  Pin `create-narduk-app`'s own `prettier` devDependency to the one workspace
  version (`3.9.4`). Its published manifest declared the exact `3.8.3`, so a
  consumer installing it from the packed artifact — outside the workspace where
  `pnpm.overrides` applies — resolved a prettier that formats a multi-member
  union differently from CI, re-creating narduk-libs#175 one hop out.

## 0.2.0

### Minor Changes

- 6056720: Make invitation acceptance atomic across its claim, membership,
  optional resource override, and audit events. Prevent concurrent invitations
  from admitting two presenters, protect the last owner inside membership
  mutations, and prevent revocation from racing a completed acceptance. Add
  optional consumer-verified email matching without importing an authentication
  provider.

  Atomic invitation acceptance requires the real Drizzle D1 database (`batch`)
  or better-sqlite3 database (`$client.transaction`). Query-only wrappers must
  forward that capability; unsupported adapters fail before claiming an
  invitation.

## 0.1.0

### Minor Changes

- 7063f06: Add `@narduk-enterprises/narduk-tenancy`, the generic tenancy package
  (narduk-libs#171, company-hq D-7): organizations, memberships over the
  `owner > admin > operator > crew > viewer` role ladder, per-resource role
  overrides that may only narrow an org role, digest-only single-use
  invitations, time-boxed read-only support grants (ADR-0010 — support is a
  grant, never a role), and an audit row for every mutation. The package ships a
  D1/SQLite drizzle schema plus one additive hand-written migration, a
  dialect-neutral service factory that takes the consumer's own drizzle database
  and injectable clock/id/token generators, and two thin H3 entitlement guards.
  Resources are generic (`resource_kind` + opaque `resource_id`) and users are
  opaque text ids owned by the consuming app, so nothing here imports
  narduk-auth or declares a foreign key across that boundary.
