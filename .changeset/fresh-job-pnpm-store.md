---
'@narduk-enterprises/create-narduk-app': patch
---

Generated GitHub jobs now install from a fresh job-owned pnpm store. The public
CI jobs and the D1 migration templates (`ci-d1-bundle.job.yml`,
`preview-d1.yml`) create a unique directory under `RUNNER_TEMP` and export it as
`NPM_CONFIG_STORE_DIR` through `GITHUB_ENV`, so the nested install inside
`cf:build` uses the same store instead of the runner's persistent one. The
install step refuses to run unless `pnpm store path` resolves inside that
directory (a `pnpm-workspace.yaml` `storeDir` would otherwise win), then runs
the unchanged `pnpm install --frozen-lockfile`. The migration templates also
run `pnpm exec narduk-app --help` from `apps/web` right after the install, so a
CLI that cannot load fails before any D1 or promotion step. Newly generated apps
and copied templates only; no existing app is changed, and a lane's own
worktree install keeps its shared default cache. Refs
narduk-enterprises/agent-infrastructure#3549.
