import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'

const packageJson = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'))
const failures = []

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

for (const requiredFile of ['README.md', 'CHANGELOG.md', 'LICENSE']) {
  const fileUrl = new URL(`../${requiredFile}`, import.meta.url)
  if (!existsSync(fileUrl)) failures.push(`package file missing: ${requiredFile}`)
}

if (failures.length > 0) {
  console.error(failures.join('\n'))
  process.exit(1)
}

console.log(`Checked ${Object.keys(packageJson.exports ?? {}).length} package exports.`)
