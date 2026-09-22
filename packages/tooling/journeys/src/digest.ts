import { createHash } from 'node:crypto'
import { readFileSync, readdirSync } from 'node:fs'
import { join, relative } from 'node:path'

/**
 * The declaration digest (spec 4.2): a hash of the catalog's SOURCE, because
 * the executable step bodies are part of the declaration - a prose-only
 * projection would call two behaviourally different catalogs identical. Files
 * are hashed as sorted (relative path, content) pairs so the digest is stable
 * across traversal order and machines.
 */
export function digestFiles(files: ReadonlyMap<string, Buffer | string>): string {
  const hash = createHash('sha256')
  const separator = Buffer.from([0])
  for (const path of [...files.keys()].sort()) {
    const content = files.get(path)
    if (content === undefined) continue
    hash.update(path)
    hash.update(separator)
    hash.update(content)
    hash.update(separator)
  }
  return `sha256:${hash.digest('hex')}`
}

const IGNORED_DIRECTORIES = new Set(['node_modules', 'dist', '.git', '.journeys'])

/**
 * Digest every regular file under a catalog directory, whatever its size.
 *
 * There is no size cap: a file the walk skipped could change without moving
 * the digest, so evidence captured under the old declaration would still
 * verify (narduk-libs#118). Reading a few megabytes costs nothing next to the
 * browser run the digest gates.
 */
export function digestDirectory(root: string): string {
  const files = new Map<string, Buffer>()
  const walk = (directory: string): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (IGNORED_DIRECTORIES.has(entry.name)) continue
      const full = join(directory, entry.name)
      if (entry.isDirectory()) {
        walk(full)
      } else if (entry.isFile()) {
        files.set(relative(root, full), readFileSync(full))
      }
    }
  }
  walk(root)
  return digestFiles(files)
}
