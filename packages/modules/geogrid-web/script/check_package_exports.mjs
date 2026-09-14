import { existsSync, readdirSync } from 'node:fs'
import { readFile } from 'node:fs/promises'

const packageJson = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'))
const failures = []

/**
 * Source barrels that exist on purpose and are deliberately NOT public.
 *
 * The reverse-drift check below is fail-closed: a new `src/<dir>/index.ts` is
 * assumed to be a subpath somebody forgot to publish, because that is what it
 * has always turned out to be. Anything genuinely internal is named here, so
 * "internal" is a decision in the repository rather than an omission nobody
 * notices until a consumer's deep import breaks on the next refactor.
 */
const INTERNAL_SUBPATHS = new Set()

for (const [exportPath, target] of Object.entries(packageJson.exports ?? {})) {
  const importPath = target?.import
  const typesPath = target?.types

  if (typeof importPath !== 'string') {
    failures.push(`${exportPath}: missing import target`)
    continue
  }
  if (typeof typesPath !== 'string') {
    failures.push(`${exportPath}: missing types target`)
    continue
  }

  const importUrl = new URL(`../${importPath.replace(/^\.\//, '')}`, import.meta.url)
  const typesUrl = new URL(`../${typesPath.replace(/^\.\//, '')}`, import.meta.url)
  if (!existsSync(importUrl)) failures.push(`${exportPath}: ${importPath} does not exist`)
  if (!existsSync(typesUrl)) failures.push(`${exportPath}: ${typesPath} does not exist`)

  if (existsSync(importUrl)) {
    await import(importUrl.href)
  }

  // A subpath whose built target exists can still be stale. `dist/` survives
  // between builds, so a subpath renamed or removed in `src/` keeps passing the
  // existence checks above until someone cleans, and the failure then surfaces
  // in a consumer's install rather than here. Pin every subpath to its source
  // barrel so the export map and the source tree cannot drift apart quietly.
  if (exportPath === '.') continue
  const subpath = exportPath.replace(/^\.\//, '')
  if (!existsSync(new URL(`../src/${subpath}/index.ts`, import.meta.url))) {
    failures.push(`${exportPath}: no source barrel at src/${subpath}/index.ts`)
  }
}

// The drift the loop above cannot see: a source barrel that exists and is not
// exported at all. `src/tile/index.ts` was written, built, documented and
// tested through a relative import for a whole afternoon before anyone noticed
// that installing the package gave you no way to reach it — the export map is
// the one place a subpath's absence is invisible from inside the repo.
const exportedSubpaths = new Set(
  Object.keys(packageJson.exports ?? {})
    .filter((exportPath) => exportPath !== '.')
    .map((exportPath) => exportPath.replace(/^\.\//, '')),
)
const sourceRoot = new URL('../src/', import.meta.url)
for (const entry of readdirSync(sourceRoot, { withFileTypes: true })) {
  if (!entry.isDirectory()) continue
  if (!existsSync(new URL(`${entry.name}/index.ts`, sourceRoot))) continue
  if (exportedSubpaths.has(entry.name) || INTERNAL_SUBPATHS.has(entry.name)) continue
  failures.push(
    `src/${entry.name}/index.ts is a source barrel with no "./${entry.name}" export ` +
      `(add one, or list it in INTERNAL_SUBPATHS)`,
  )
}

for (const requiredFile of ['README.md', 'CHANGELOG.md', 'LICENSE']) {
  const fileUrl = new URL(`../${requiredFile}`, import.meta.url)
  if (!existsSync(fileUrl)) failures.push(`package file missing: ${requiredFile}`)
}

if (failures.length > 0) {
  console.error(failures.join('\n'))
  process.exit(1)
}

console.log(`Checked ${Object.keys(packageJson.exports ?? {}).length} package exports.`)
