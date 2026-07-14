# Changesets

Add one changeset for each public package change. Changesets are independent:
only named packages receive a version bump and release. Keep this directory
empty between releases unless a package change is ready to ship.

The release workflow uses the checked-in configuration and publishes only
immutable versions to GitHub Packages. It never coordinates an app repository.
`pnpm run release:version` also refreshes the generator's exact internal package
pins from the newly versioned manifests; `pnpm run versions:check` fails CI if
those pins ever drift.
