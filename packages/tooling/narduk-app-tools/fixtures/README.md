# Cross-package fixtures

`default-deployment-block.json` is the `deployment` block a newly generated app
is told to paste into `Config/cloudflare-app.json`, for the app slug
`paste-check`.

It exists so two packages that must agree can be pinned to each other without
one depending on the other. `create-narduk-app` emits that block in its
`docs/workers-builds.md` runbook and tells the app to run
`narduk-app foundation:check:deployment` against it, but the schema that check
enforces lives here. A runtime dependency from the generator on this package
would be wrong (a published `create-narduk-app` requires nothing), and a
development one still would not survive CI, whose per-package gates run
`pnpm --filter <name>` without building a workspace sibling's `dist`.

So the fixture is the shared pin, and two tests hold the chain:

- `tests/foundation/item-12-deployment-standard.test.ts` asserts this file
  equals `defaultDeploymentBlock({ appSlug: 'paste-check' })` and that
  `readDeploymentBlock` accepts it.
- `create-narduk-app`'s `tests/generator.test.ts` reads this file by relative
  path and asserts the fenced block in the generated runbook parses to exactly
  it.

Add a required key to the schema and the first test fails until this file and
`defaultDeploymentBlock` are updated; updating this file then fails the second
until the generator is too. Neither assertion can be satisfied by a block that
would fail the check a new app is told to run.

This directory is not published: `package.json`'s `files` list does not name it.
