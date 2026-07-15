# Changesets

Add one changeset for each public package change. Changesets release the named
packages plus any internal dependents that must move to preserve exact package
links. Keep this directory empty between releases unless a package change is
ready to ship.

The release workflow uses the checked-in configuration and publishes only
immutable versions to GitHub Packages. It never coordinates an app repository.
`pnpm run release:version` also refreshes the generator's own reported version,
README command, and exact internal package pins from the newly versioned
manifests; `pnpm run versions:check` fails CI if that metadata ever drifts.
`pnpm run release-plan:check` also requires a generator release whenever the
resolved Changesets plan changes a package version hard-coded by the generator.
