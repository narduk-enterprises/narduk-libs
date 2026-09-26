import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach } from 'vitest'

const created: string[] = []

// Removed after every test, passed or failed. These suites once left tens of
// thousands of `njr-*` directories in $TMPDIR (narduk-libs#1127).
afterEach(() => {
  for (const directory of created.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

/** A fresh directory under the OS temp dir, deleted after the current test. */
export function tempDir(prefix: string): string {
  const directory = mkdtempSync(join(tmpdir(), prefix))
  created.push(directory)
  return directory
}
