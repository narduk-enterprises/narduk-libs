---
'@narduk-enterprises/create-narduk-app': minor
---

Scaffold new apps on TypeScript 6.0 (`6.0.3`), inside the D-TOOLCHAIN-1 `~6.0.3` baseline (narduk-libs#307).

The generated root `package.json` now pins exact `typescript: 6.0.3` (inside the baseline `~6.0.3` range; the generator pins every dependency exactly) instead of `5.9.3`. The rest of D-TOOLCHAIN-1 (Node 24 through `.node-version`, `engines.node`, the current shared-workflow pin and the `github-actions` Dependabot block) had already landed, so this was the last stale point. The workspace moves in the same change: every narduk-libs package now builds and typechecks with TypeScript `~6.0.3`, so a scaffolded app and the packages it consumes are compiled with the same major.
