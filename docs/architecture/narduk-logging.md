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
