# @narduk-enterprises/narduk-tenancy

## 0.3.0

### Minor Changes

- 31a43a7: Correct published packaging declarations so they match what these
  packages already require at install time. This is not a runtime change.

  Nine Nuxt modules already depend on `@nuxt/kit` `^4.0.0`, which does not run
  on Nuxt 3, but advertised `peerDependencies.nuxt` as `>=3.16.0`. The peer is
  now `>=4.0.0`, matching narduk-shell and narduk-mapkit-nuxt. `narduk-core` and
  `narduk-realtime` also raise `@nuxt/schema` to `>=4.0.0` so it matches `nuxt`.
  `narduk-core` and `narduk-analytics` add exact `./app/types/*` entries for the
  `.ts` files that the `*.d.ts` export pattern could not resolve. The analytics
  key exports runtime `const`s, so it carries `types` then `import` then
  `default`. Core `./app/types/api` stays types-only because that file is
  interfaces. `narduk-app` declares `zod` `^4.4.3` as an optional peer (kept in
  `devDependencies`) so consumers that typecheck `./server/request-body` can
  resolve `z.ZodType` without warning HTTP-only consumers. `narduk-shell`
  tightens `vue-router` to `^5.3.1` so the published package matches `@nuxt/ui`
  `4.8.1` and the workspace override.

  ## Operator action

  The Nuxt 4 peer (`nuxt` and, where declared, `@nuxt/schema`) is a
  consumer-visible floor raise, so the nine modules that advertised Nuxt 3 ship
  as `minor`. Every narduk-app in the estate is already on Nuxt 4; Buoys is on
  4.5.2. A remaining Nuxt 3 app cannot take this release — and already could not
  run these modules, because they depend on `@nuxt/kit` `^4.0.0`.
  `create-narduk-app` is a companion patch so generator pins move with the
  minors. `narduk-app` (optional zod peer) and `narduk-shell` (vue-router
  already at UI 4.8.1) stay `patch`.

### Patch Changes

- 8186003: Create an org, its owner membership, and both audit rows in one
  `runTenancyBatch`.

  `createOrg` used four separate D1 auto-commits. A failed membership write
  after the org insert left an ownerless row that burned the slug and never
  appeared in `listOrgsForUser`. Invite acceptance already batched for this
  reason; org creation now matches.

  This is a patch: exported function signatures are unchanged. The behavior
  change is a correctness fix, not a new API.

  A concurrent `createOrg` that loses the unique-index race on
  `tenancy_orgs.slug` or `tenancy_memberships (org_id, user_id)` now throws
  `TenancyError('conflict')` instead of a raw D1/SQLite constraint message. The
  unique index remains the real gate; the pre-read is still sequential UX only.

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
