---
'@narduk-enterprises/narduk-app-tools': minor
---

Add `narduk-app foundation:check:toolchain` — foundation item 11,
`toolchain-single-source` (Logan, askme 2026-09-17: _"Single-source toolchain
versions (Recommended)"_ — one declared Node/pnpm source per app; every other
place either reads it or is checked against it, so a bump is one edit).

The command prints every place the app writes a Node or pnpm version down, with
its file, line, value and verdict, and fails on any disagreement. Like items 8,
9 and 10 it is a separate command and JSON artefact
(`tool: '@narduk-enterprises/narduk-app-tools/toolchain-single-source'`),
because `foundation:check --json` is the exact 7-item contract company-hq
`check-web-foundation.py` validates. Same exit codes, no warn tier, no
credential required.

**The sources, chosen on what tools actually read.** Node is `.node-version`:
the widest native readership (`actions/setup-node` via `node-version-file`, fnm,
mise, nodenv) and, decisively, the only Node declaration a workflow can _point
at_ rather than restate — which is what removes the CI literal entirely. pnpm is
the root manifest's `packageManager`: corepack, pnpm itself and
`pnpm/action-setup` all read it natively, and the shared `nuxt-cloudflare.yml`'s
own pnpm step already relies on exactly that.

Everything else is a mirror, because Volta and npm can read a version from
nowhere but a manifest and a Markdown table reads nothing: `engines.*`,
`volta.*`, an optional `.nvmrc` or `.tool-versions`, and the
`docs/workers-builds.md` rows that record the Cloudflare dashboard build
environment. A mirror either derives from the source — a workflow's
`node-version-file`, a `pnpm/action-setup` with no `version:` — or is compared
against it.

**`--fix` closes the loop.** It rewrites a drifted mirror's literal on the exact
line the scan located, leaving every other byte alone (no `JSON.stringify` round
trip, so an app's own manifest is not reformatted or reordered), and a Markdown
row keeps its column width where the padding can absorb the change. Bumping Node
becomes: edit `.node-version`, run `--fix`.

It deliberately does not rewrite a workflow. Turning `node-version:` into
`node-version-file:`, or dropping a `pnpm/action-setup` `version:` input,
changes the shape of a file the app owns and its contract with the shared
workflow — a one-time migration, reported with the exact edit and left for a
human. It also will not invent a missing `.node-version`: with no source there
is nothing to derive from, and promoting a mirror would be a guess.

A CI literal that currently _agrees_ with the source is still a finding: it is a
second declaration, and the second declaration is the thing being removed.
