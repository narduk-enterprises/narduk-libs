---
'@narduk-enterprises/narduk-app-tools': patch
---

Fix `narduk-app db migrate` for npm-based consumers. It previously shelled every
wrangler invocation through the active package manager's `exec` subcommand
(`spawnPnpmSync(['exec', 'wrangler', ...])`), which either invokes `npm exec`
(silently dropping the `--command` flag's value under npm's argument parsing) or
crashes outright when `pnpm exec` refuses to run inside an npm-configured
consumer. Wrangler is now resolved and spawned directly (the consumer's own
`node_modules/.bin/wrangler`, falling back to Node module resolution from the
consumer root), independent of which package manager is active
(narduk-libs#122).
