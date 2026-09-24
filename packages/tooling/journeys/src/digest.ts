import { createHash } from 'node:crypto'
import { readFileSync, readdirSync } from 'node:fs'
import { join, relative } from 'node:path'

import type { Journey } from './types.js'

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

/**
 * Capture (Playwright) and verify (plain Node / Vitest) pretty-print the
 * same function differently: ASI semicolons, indent, and object literals
 * broken across lines. Collapse that so the digest is about the body, not
 * the loader (narduk-libs#66).
 */
function normalizeFunctionSource(source: string): string {
  return source.replaceAll(/\s+/g, ' ').replaceAll(';', '').trim()
}

function functionSource(value: unknown): string | null {
  return typeof value === 'function' ? normalizeFunctionSource(value.toString()) : null
}

/**
 * The digest of ONE journey's declared shape, including executable step
 * bodies (`do` / `appliesIf` source, normalized so Playwright and Node
 * agree). Sibling journeys and other files under the catalog directory are
 * not part of this hash, so adding journey N+1 does not invalidate a
 * promoted capture of journey N (narduk-libs#66).
 *
 * Shared helpers a step *calls* are the honest gap: a change inside an
 * imported function does not move this digest unless the step's own source
 * changes. Hashing the module graph would close that and re-introduce a
 * file-layout dependency this form is designed not to have.
 */
export function digestJourney(journey: Journey): string {
  const record: Record<string, unknown> = {
    id: journey.id,
    title: journey.title,
    surface: journey.surface,
    role: journey.role,
    scenarios: [...journey.scenarios],
    outcome: journey.outcome,
    tags: journey.tags ?? null,
    compromises: journey.compromises ?? null,
    steps: journey.steps.map((step) => {
      const entry: Record<string, unknown> = {
        id: step.id,
        say: step.say,
        skipWhen: step.skipWhen ?? null,
        capture: step.capture ?? null,
      }
      if ('do' in step) {
        entry.do = functionSource(step.do)
        entry.appliesIf = functionSource(step.appliesIf)
      }
      if ('press' in step) {
        entry.press = step.press
        entry.lands = step.lands
      }
      return entry
    }),
  }
  if (journey.surface !== 'web') {
    record.drive = journey.drive ?? 'xctest'
    if (journey.drive === 'driven') {
      record.launchArgs = journey.launchArgs
      record.start = journey.start
    } else {
      record.binding = journey.binding
    }
  }
  return digestFiles(new Map([[`journey:${journey.id}`, JSON.stringify(record)]]))
}
