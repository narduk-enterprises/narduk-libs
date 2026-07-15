# Package release and rollback runbook

`narduk-libs` publishes independent, immutable SemVer packages to GitHub
Packages. A release never republishes an existing version and never unpublishes
an artifact.

## Normal release

1. Add a Changeset for every publishable package whose public artifact changes.
2. Open or update the release PR by merging the package change to `main`. The
   release workflow runs quality, strict package checks, and the packed
   generated-app consumer smoke before Changesets receives write credentials.
3. Let app CI validate the release PR from a fresh frozen install. The packed
   consumer gate must prove every runtime dependency between local packages was
   rewritten from `workspace:*` to the exact coordinated release version; this
   prevents stale core, auth, or platform versions from entering the graph.
4. Review and merge the release PR. Changesets publishes only the versions in
   that release plan.
5. When Changesets reports `published=true`, the workflow waits for registry
   propagation, resolves every publishable manifest at its exact version, and
   performs both an initial and frozen external consumer install. A release is
   not complete until this proof passes.

The Changesets run that only opens a release PR does not publish and therefore
skips the post-publish registry proof.

This organization is on GitHub Free, so private repositories cannot consume
organization-level Actions secrets. Keep the read and write package tokens as
repository-scoped Actions secrets named `NARDUK_PLATFORM_GH_PACKAGES_READ` and
`NARDUK_PLATFORM_GH_PACKAGES_WRITE`; record only their names and rotation time,
never their values.

## Failed or partial publish

- Do not change, delete, or reuse a version that may have reached the registry.
- Fix authentication, registry availability, or the failing package metadata,
  then rerun the failed release job. Changesets leaves already-published exact
  versions intact and publishes the remaining planned versions.
- Confirm the current manifests with `pnpm run release:verify-published` using a
  temporary authenticated npm config. Do not place tokens in the repository.
- If package manifests had to change, create a new Changeset and publish higher
  versions instead of attempting to replace an artifact.

## Bad release rollback

1. Stop app rollouts and identify the last known-good exact package versions.
2. Deprecate each bad exact version with a message naming its replacement. Do
   not unpublish it. If immediate containment is necessary, move the `latest`
   dist-tag back to the known-good exact version; apps must still use exact pins
   rather than relying on the tag.
3. Revert or correct the source, add a corrective Changeset, synchronize the
   generator's exact package pins, and publish a higher SemVer version.
4. For an affected app, revert its package-pin change, restore the prior frozen
   lockfile, pass app-owned CI, deploy through Workers Builds, and record the
   deployed SHA and route proof.
5. Database rollback is forward-only. Never reset a remote D1 database; ship a
   corrective migration after validating it against a production copy and its
   recovery snapshot.

Keep the failed workflow, package versions, deprecation message, corrective
release, consumer proof, and affected app deployment evidence in the migration
ledger.
