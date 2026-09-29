---
'@narduk-enterprises/narduk-app-tools': minor
---

Remove development mode, `deploy-local` and `deploy-hotfix`. `narduk-app ship` replaces all three (see `docs/ship.md`); there is no separate break-glass path.

Removed CLI commands: every `narduk-app development *` subcommand (`enter`, `status`, `resolve`, `pin`, `unpin`, `exec`, `validate`, `deploy`, `rollback`, `handoff`, `accept`, `exit`), `narduk-app deploy-local` and `narduk-app deploy-hotfix`.

Removed exports from the package root: the development-mode capability schemas and types (`developmentSchema`, `developmentCommandSchema`, `developmentComponentSchema`, `developmentVaultSelectorSchema`, `reservedDevelopmentVariable`, `DEFAULT_PROTECTED_PATHS` and their types), everything exported by the deploy-local module (`runDeployLocal`, `parseDeployLocalArgs`, `readDeployLocalSecrets`, `isGitWorkingTreeClean`, `buildMergedDeployEnv`, `normalizeDeployHostname`, `isNonLocalHttpsUrl`, `DeployLocalFlags`, `DeployLocalOptions`) and the deploy-hotfix module (`runHotfix`, `parseHotfixArgs`, `HotfixContext`). `scanPublicAssetsForSecretLeaks` stays exported. The docs `development-mode.md` and `local-hotfix.md` are gone.

`deployment.development` in `Config/cloudflare-app.json` is now ignored rather than validated: a config that still carries the block keeps parsing, and the block can be deleted at leisure. Run `narduk-app development exit` for any activation still open before upgrading; this version cannot restore workflows an activation disabled.
