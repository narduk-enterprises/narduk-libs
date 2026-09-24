# Logging language colocation decision

Status: accepted by the implementation request, 2026-09-09.

Narduk Logging is a specific exception to the usual separate-repository rule for
language-specific libraries. TypeScript, Swift, Python, their canonical
schema/fixtures, and adoption examples live together under
`packages/modules/narduk-logging`. The responsibility is one cross-runtime
logging contract, with shared privacy fixtures and release compatibility.

The npm distribution is `@narduk-enterprises/narduk-logging`. The
repository-root `Package.swift` publishes product `NardukLogging`; repository
`vX.Y.Z` tags are reserved for SwiftPM. Python distribution `narduk-logging`
publishes wheel and source artifacts on private GitHub Releases with checksums.
npm Changesets package tags and Python-specific release tags remain independent.

Core keeps its legacy public logger facade while using the new implementation.
New apps declare identity and info verbosity; old apps retain their defaults.
Provider credentials and production collector declarations belong to `fleet`.
The generator remains deterministic and local, with no ongoing enrollment,
reconciliation, or remote provisioning relationship.

The initial backend is native Grafana, Alloy, and single-binary Loki on a
dedicated fleet-owned guest, with private R2 storage and 14-day searchable
history. Actual provisioning and operational proof belong to the fleet change;
library validation alone does not prove that deployment exists or works.

## Second Swift exception: NardukAuthKit

Status: accepted by Logan, 2026-09-24, superseding narduk-libs#76's "Swift kits
stay out" for this package.

NardukAuthKit moved here from narduk-enterprises/narduk-auth-kit at
`a65296ff8e7cf5a1afafa6b534c88919139fc6bb` (its tag `0.2.1`), without history.
Logan's reason: it is the Apple client half of narduk-auth's native PKCE flow,
so it lives beside the server half, under `packages/modules/narduk-auth/swift`.
The npm package does not publish that directory.

The repository-root `Package.swift` now publishes two products from one set of
`vX.Y.Z` tags: `NardukLogging` and `NardukAuthKit`. `v0.1.0` carries logging
alone; `v0.2.0` is the first tag with NardukAuthKit. Both products share the
manifest's platform floor, so NardukAuthKit requires macOS 15 and iOS 18 where
the standalone package allowed macOS 14 and iOS 17. NardukAuthKit needs Security
and CryptoKit, so the manifest declares its targets only on an Apple host, and
its own GitHub-hosted macOS job (`.github/workflows/auth-kit-swift.yml`) gates
it instead of the Linux Swift job.

The manifest declares Swift tools 6.2, not 6.3, because narduk-nvr builds on the
fleet Apple runner's Xcode 26.0.1 (Swift 6.2), and SwiftPM refuses a newer tools
version than the toolchain it runs. The macOS job repeats the version-tag
consumer on that Xcode. NardukLogging's own gates still use Swift 6.3.3.
