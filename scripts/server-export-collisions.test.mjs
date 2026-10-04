import assert from 'node:assert/strict'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import test from 'node:test'

// Every module registers its server directory with `addServerScanDir`, so each
// top-level `export` under `server/utils/` (or `runtime/server/utils/`) becomes
// a bare auto-import in any app that loads the module. Two modules exporting the
// same name make Nuxt keep one and print "Duplicated imports ... has been
// ignored" in a green build (narduk-libs#1404): a sync `timingSafeEqualText`
// and an async one with the same name differed by a `Promise`, which is always
// truthy in an `if (!compare(...))` guard. The warning is easy to miss, so the
// collision fails here instead.
const MODULES_DIR = 'packages/modules'
const SERVER_UTIL_DIRS = ['server/utils', 'runtime/server/utils']

const DECLARATION =
  /^export\s+(?:async\s+)?(?:function\*?|const|let|var|class|enum)\s+([A-Za-z_$][\w$]*)/gm
const NAMED_LIST = /^export\s*\{([^}]*)\}(?!\s*from)/gm
const REEXPORT_LIST = /^export\s*\{([^}]*)\}\s*from/gm

function exportedValueNames(source) {
  const names = new Set()
  for (const match of source.matchAll(DECLARATION)) names.add(match[1])
  for (const re of [NAMED_LIST, REEXPORT_LIST]) {
    for (const match of source.matchAll(re)) {
      for (const part of match[1].split(',')) {
        const trimmed = part.trim()
        if (!trimmed || trimmed.startsWith('type ')) continue
        const alias = trimmed.split(/\s+as\s+/).pop()
        if (alias) names.add(alias.trim())
      }
    }
  }
  return names
}

/** The files Nitro scans for auto-imports: `.ts`/`.mjs`/`.js` directly in the dir. */
function scannedFiles(dir) {
  if (!existsSync(dir)) return []
  return readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && /\.(?:ts|mts|js|mjs)$/.test(entry.name))
    .filter((entry) => !/\.(?:test|spec|d)\.[cm]?[jt]s$/.test(entry.name))
    .map((entry) => join(dir, entry.name))
}

export function collectServerExports(modulesDir = MODULES_DIR) {
  const owners = new Map()
  for (const moduleName of readdirSync(modulesDir)) {
    for (const rel of SERVER_UTIL_DIRS) {
      for (const file of scannedFiles(join(modulesDir, moduleName, rel))) {
        for (const name of exportedValueNames(readFileSync(file, 'utf8'))) {
          if (!owners.has(name)) owners.set(name, [])
          owners.get(name).push(file)
        }
      }
    }
  }
  return owners
}

test('no two libs modules export the same server auto-import name', () => {
  const owners = collectServerExports()
  assert.ok(owners.size > 50, `expected the modules' server exports, found ${owners.size}`)
  const collisions = []
  for (const [name, files] of owners) {
    const modules = new Set(files.map((file) => file.split('/')[2]))
    if (modules.size > 1) collisions.push(`${name}: ${files.join(', ')}`)
  }
  assert.deepEqual(
    collisions,
    [],
    `server auto-import names owned by more than one module:\n${collisions.join('\n')}`,
  )
})

test('the detector catches the timingSafeEqualText shape', () => {
  const sync = 'export function timingSafeEqualText(left: string, right: string): boolean {}'
  const asyncVariant = 'export async function timingSafeEqualText(a: string, b: string) {}'
  assert.deepEqual([...exportedValueNames(sync)], ['timingSafeEqualText'])
  assert.deepEqual([...exportedValueNames(asyncVariant)], ['timingSafeEqualText'])
  assert.deepEqual([...exportedValueNames('export { a, type B, c as d }')].sort(), ['a', 'd'])
})
