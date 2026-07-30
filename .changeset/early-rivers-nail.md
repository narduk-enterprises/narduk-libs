---
---

Pin `@playwright/test` (and `playwright` where present) exactly to the
pool-supported `1.61.1` across the workspace, and add a fail-closed isolated
Playwright toolchain preflight to `packed-consumer-smoke`. Internal
devDependency and CI-only change; no published package's public API,
dependencies, or peerDependencies changed, so no package release is needed.
