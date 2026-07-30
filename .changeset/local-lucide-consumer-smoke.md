---
'@narduk-enterprises/narduk-core': patch
'@narduk-enterprises/create-narduk-app': patch
---

Configure the local Lucide server and core-header client bundles before Nuxt UI
installs its icon module, and generate the core module before Nuxt UI so that
ordering remains deterministic in packed consumers.
