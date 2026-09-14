import assert from 'node:assert/strict'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import * as prettier from 'prettier'

/**
 * narduk-libs#105: `changesets` writes `CHANGELOG.md` during the release job
 * without running Prettier over what it writes, and every package's
 * `format:check` glob includes `**\/*.md`, so the generated file was in
 * scope for a gate that never saw it before it landed on `main` — reproduced
 * 2026-08-28 on a clean `origin/main` checkout. Excluding generated
 * changelogs from the format contract (rather than formatting them in the
 * release job) is the smaller, more honest fix: they are release output, not
 * hand-authored source.
 */

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..')

test('.prettierignore excludes generated package CHANGELOG.md files', async () => {
  const info = await prettier.getFileInfo(
    join(repoRoot, 'packages/tooling/create-narduk-app/CHANGELOG.md'),
    { ignorePath: [join(repoRoot, '.gitignore'), join(repoRoot, '.prettierignore')] },
  )
  assert.equal(info.ignored, true)
})
