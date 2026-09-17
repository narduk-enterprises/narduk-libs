import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

/**
 * narduk-libs#395: `packages/modules/narduk-logging/src/timing.ts` shipped with raw `0x00`,
 * `0x1f` and `0x7f` bytes inside a regex character class — written as literal control characters
 * where an escape sequence was meant. Git then classified the file as binary, so GitHub's "Files
 * changed" view rendered "Binary file not shown" for the entire new module (the reviewed diff was
 * empty), `grep`/`rg` skipped it, and the NUL byte propagated into the published `dist/timing.js`.
 * Prettier, ESLint, tsc and publint all passed: nothing in the repo looked at the bytes. The same
 * mistake was already sitting on `main` in `narduk-auth`'s WebAuthn challenge hashing.
 *
 * This test is the missing gate. Source is text; a control byte in it is always a mistake that
 * should have been an escape sequence. Note that this file deliberately contains no escape
 * sequences of its own — the characters are named by code point — because writing one is exactly
 * the step that went wrong.
 */

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..')

const TAB = 9
const LINE_FEED = 10
const CARRIAGE_RETURN = 13
const FIRST_PRINTABLE = 32
const DELETE = 127

/** Tab, newline and carriage return are the legitimate control characters in source text. */
function isForbidden(code) {
  if (code === TAB || code === LINE_FEED || code === CARRIAGE_RETURN) return false
  return code < FIRST_PRINTABLE || code === DELETE
}

const SOURCE_EXTENSIONS = new Set([
  '.ts',
  '.mts',
  '.cts',
  '.tsx',
  '.js',
  '.mjs',
  '.cjs',
  '.jsx',
  '.vue',
  '.css',
  '.json',
  '.md',
  '.yml',
  '.yaml',
])

const SKIP_DIRECTORIES = new Set([
  '.git',
  'node_modules',
  'dist',
  'build',
  '.turbo',
  '.nuxt',
  '.output',
  'coverage',
  '.lane-evidence',
])

function* sourceFiles(directory) {
  for (const name of readdirSync(directory)) {
    if (SKIP_DIRECTORIES.has(name)) continue
    const absolute = join(directory, name)
    if (statSync(absolute).isDirectory()) {
      yield* sourceFiles(absolute)
      continue
    }
    const extension = name.slice(name.lastIndexOf('.'))
    if (SOURCE_EXTENSIONS.has(extension)) yield absolute
  }
}

/** First offending byte in `contents`, as `{ line, code }`, or undefined when it is clean. */
function firstControlByte(contents) {
  let line = 1
  for (let index = 0; index < contents.length; index += 1) {
    const code = contents.charCodeAt(index)
    if (code === LINE_FEED) {
      line += 1
      continue
    }
    if (isForbidden(code)) return { line, code }
  }
  return undefined
}

test('no tracked source file contains a raw control byte', () => {
  const offenders = []
  for (const absolute of sourceFiles(repoRoot)) {
    const found = firstControlByte(readFileSync(absolute, 'utf8'))
    if (!found) continue
    const code = found.code.toString(16).padStart(4, '0')
    offenders.push(`${relative(repoRoot, absolute)}:${found.line} contains U+${code.toUpperCase()}`)
  }
  assert.deepEqual(
    offenders,
    [],
    `Source files must be text. Write the character as an escape sequence instead:\n${offenders.join('\n')}`,
  )
})
