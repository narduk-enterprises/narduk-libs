# @narduk-enterprises/narduk-tenancy

## 0.5.0

### Minor Changes

- 55d4006: Index the org-scoped membership ordering and the pending-invite
  predicate.

  A new `drizzle/0002_org_list_indexes.sql` adds three
  `CREATE INDEX IF NOT EXISTS` statements for the two list reads a consuming
  app's org console issues. Neither read was a full table scan before -- `0001`
  already narrows to one org -- but both paid for everything the org had
  accumulated rather than for what they returned: a 200-member page read and
  sorted every membership in the org, and the live-invite list and its
  `count(*)` read every invitation the org had ever issued, accepted and revoked
  rows included.

  Measured by rows visited, a member page now costs 201 reads whether the org
  has 200 members or 5 000 (was 200, 1 000 and 5 000), and five live invitations
  cost five reads whether 0, 50 or 500 accepted invitations sit behind them (was
  5, 55 and 505).

  Additive and `IF NOT EXISTS` throughout, with no down-migration, so an app
  already carrying these indexes in its own migration finds them present rather
  than duplicated.

### Patch Changes

- 3afc622: Prove cross-org isolation with a suite built on deliberately
  colliding data: two orgs in one database sharing an identity, a resource id,
  an email, an actor, and a clock, so a passing assertion can only come from org
  scoping rather than from the fixtures happening to differ. It covers per-org
  role resolution for one identity, resource-role overrides not bleeding across
  orgs, `listOrgsForUser` returning only real memberships, the audit trail and
  support grants each confined to their own org, an invitation landing only in
  the issuing org, `removeMember` leaving the other org's membership and
  identically keyed override intact, and a stranger being refused identically
  whether the org exists or not, so the refusal is no existence oracle.
  Mutation-tested four ways to prove the suite can fail.

  Test-only: no runtime behaviour, no exported surface, and no published file
  changes — `tests/` is outside the package's `files` list, so this release
  ships an identical tarball.

- c494a66: Re-check rank inside the write for every remaining tenancy mutation

  `addMember`, `setResourceRoleOverride`, `clearResourceRoleOverride` and
  `createInvite` ranked from a read made just before the write, not inside it. A
  role change landing in that window let one change through against the roles as
  they were read: a demoted admin could still add a member, set or clear a
  resource override, or mint an invite.

  Each now carries the rank inputs into the statement itself — an
  `INSERT … SELECT … WHERE` for the two inserts, and a guarded `UPDATE`/`DELETE`
  for the overrides — asserting that the actor still holds exactly the role the
  check read and that the member still stands exactly as it read them. If either
  moved, the call answers `conflict` and writes nothing, matching
  `setMemberRole` and `removeMember`. In-rank callers are unaffected.

## 0.4.0

### Minor Changes

- b0fbfb0: **BREAKING (0.x minor): `actorUserId` is required, and identified
  actors are ranked (narduk-libs#213).**

  Rank floor. An identified actor may grant a role, or act on a member who holds
  one, only at or below their own org role, or the call throws
  `TenancyError('forbidden')`. It covers `addMember`, `setMemberRole`,
  `removeMember`, `setResourceRoleOverride`, `clearResourceRoleOverride`,
  `createInvite` and, new, `acceptInvite`: an invite is refused `forbidden` once
  its inviter is no longer a member holding the invite's role or above, checked
  before the claim and again inside it. An admin can no longer make itself an
  owner, or demote, remove or narrow an owner, and an actor who is not a member
  of the org is refused before anything about the target is read.
  `setMemberRole` and `removeMember` re-assert both roles inside the write and
  answer `conflict` if either moved. Apps that want "strictly below" or an admin
  floor keep that check in their routes; the package enforces only the floor.

  Mandatory actor. `actorUserId` is now required on `addMember`,
  `setMemberRole`, `removeMember`, `setResourceRoleOverride`,
  `clearResourceRoleOverride`, `revokeInvite` and `revokeSupportGrant`. Omitting
  it no longer means a system call: a missing, `null`, empty or blank value
  throws `TenancyError('invalid')` before anything is read. A call no user makes
  passes the new exported marker `TENANCY_SYSTEM_ACTOR` (a `Symbol.for` symbol,
  so no request input can equal it); it is not ranked and is audited with a null
  actor, exactly as an omitted actor was before.

  Migration:

  - Every mutation above now needs `actorUserId`. Pass the signed-in user's id
    from the route, as most routes already do. TypeScript flags each call that
    omits it.
  - For seeding, migrations, backfills and platform tooling, pass
    `actorUserId: TENANCY_SYSTEM_ACTOR`, imported from
    `@narduk-enterprises/narduk-tenancy/server/utils/tenancy` (Nitro
    auto-imports it too). Do not substitute a made-up string such as `'system'`:
    a string is ranked as a user id and refused as a non-member.
  - Callers that passed `actorUserId: null` for a system call must switch to the
    marker.
  - Fixtures whose actor or inviter is not a member, or ranks below the role it
    hands out, now get `forbidden` and need a real member of sufficient rank.
  - An outstanding invite whose inviter has since been demoted below its role or
    removed can no longer be accepted; re-issue it from a member in rank.

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
