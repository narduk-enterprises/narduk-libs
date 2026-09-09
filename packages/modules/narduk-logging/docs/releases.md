# Package and release

All implementations share schema version 1 and the fixtures under `schema/`.
Their release versions are independent. The logging-only colocation exception is
recorded in the repository's `docs/architecture/narduk-logging.md`.

Run repository `pnpm run quality`, the package's `quality` script, Python's
`uv run --all-extras python scripts/quality.py`, and the root Swift check:

```sh
python3 packages/modules/narduk-logging/scripts/swift-quality.py
```

The TypeScript gate builds and packs the distribution, installs its tarball in a
temporary consumer outside the workspace, typechecks the public imports and runs
Node/Worker examples and a browser bundle. The repository's generated-consumer
smoke additionally builds a Nuxt app with SEO and browser logging enabled.
Python checks wheel and source installs in separate clean environments,
including the optional OTLP and Dagster dependencies. Swift resolves an actual
`v0.1.0` Git tag in an isolated source fixture and runs a separate SwiftPM
consumer.

CI runs Python and Linux Swift checks in their own jobs when logging sources,
contracts, language manifests or their CI scripts change. Ordinary npm jobs do
not need Swift. OSLog and Apple concurrency checks also run with the declared
local Xcode toolchain; Apple release validation must use a supported Apple
toolchain.

## TypeScript

Publish through the repository's verified Changesets workflow after the packed
consumer gates pass. The first logging package is `0.1.0`. The core bridge and
generator receive compatible minor releases. Existing apps choose when to adopt;
the generator performs no remote registration or fleet enrollment.

```sh
gh-packages-run pnpm add --save-exact @narduk-enterprises/narduk-logging@0.1.0
```

## Python

Build with `uv build` in `packages/modules/narduk-logging/python`. Publish both
the wheel and source archive, plus `SHA256SUMS`, to the private GitHub Release
`narduk-logging-python-v0.1.0`. Generate checksums from the exact uploaded
files. Verify the package version, clean tree, current main CI and independent
consumer checks before creating the release. Never replace an already published
artifact.

Authenticated installation uses `gh` to download first; no token is embedded in
a package URL or committed config:

```sh
mkdir -p logging-release
gh release download narduk-logging-python-v0.1.0 \
  --repo narduk-enterprises/narduk-libs --dir logging-release
cd logging-release
shasum -a 256 -c SHA256SUMS
uv pip install narduk_logging-0.1.0-py3-none-any.whl
# Optional adapters:
uv pip install './narduk_logging-0.1.0-py3-none-any.whl[otlp,dagster]'
```

## Swift

Repository tags `vX.Y.Z` are reserved for SwiftPM. Npm Changesets tags remain
package-qualified and Python tags remain `narduk-logging-python-vX.Y.Z`. Create
the Swift tag on the exact validated main commit, then prove a new consumer
resolves the remote tag before announcing the release. The consumer's Git
identity must have read access to this private repository.

```swift
.package(url: "ssh://git@github.com/narduk-enterprises/narduk-libs.git", exact: "0.1.0")
```

Select `.product(name: "NardukLogging", package: "narduk-libs")` for the
consuming target. Commit the consumer's `Package.resolved`. Roll back by
selecting its prior known-good exact version and resolved revision; never move
an existing release tag.
