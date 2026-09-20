---
'@narduk-enterprises/narduk-app-tools': minor
'@narduk-enterprises/create-narduk-app': patch
---

`doctor --adoption --live` and `foundation:check:security-headers` now probe the
paths the app declares in `deployment.liveProof`, instead of a hard-coded `/`,
`/api/health` and `x-build-version`.

Requirement 5 reads the build stamp from `liveProof.smokePath` under the header
`liveProof.buildVersionHeader`, requirement 12 reads `liveProof.healthPath`, and
requirement 8 points its header probe at the declared smoke path. With no
`--path`, `resolveProbeUrls` now reads the base URL exactly as given rather than
resolving `/` against it, so a `--base-url https://app.example/login` probes
`/login`.

`foundation:check:deployment` item 12.3 already requires those fields, so the
declaration always existed and the tools simply did not read it. On an
authenticated app -- one whose root correctly refuses an anonymous request --
that reported a working delivery path as undecided (R5) and a working health
contract as failing (R12), and rewarded an app that left its health route open
to anonymous callers over one that did not. A required `unknown` blocks
declaration, so this was not a cosmetic verdict.

The old values remain the fallback for an app that declares no `liveProof`
block, so an app declaring the defaults is unaffected. `DeploymentArtefact`
gains `declaration.liveProof`, and `AdoptionLiveReading` gains `smokeUrl`,
`healthUrl` and `buildVersionHeader` so a report names the routes it actually
read.
