import { createHash } from 'node:crypto'
import { readFileSync, readdirSync, statSync } from 'node:fs'
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

/** Digest every regular file under a catalog directory. */
export function digestDirectory(root: string): string {
  const files = new Map<string, Buffer>()
  const walk = (directory: string): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (IGNORED_DIRECTORIES.has(entry.name)) continue
      const full = join(directory, entry.name)
      if (entry.isDirectory()) {
        walk(full)
      } else if (entry.isFile() && statSync(full).size < 1_000_000) {
        files.set(relative(root, full), readFileSync(full))
      }
    }
  }
  walk(root)
  return digestFiles(files)
}
