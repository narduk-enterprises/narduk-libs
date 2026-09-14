#!/usr/bin/env node
/**
 * Vendor `tests/fixtures/render-parity-v1/` from a narduk-data checkout.
 *
 * `render-parity-v1` is a canonical, SHA-256-pinned pack that narduk-data
 * publishes at `fixtures/render-parity-v1/` and three repositories (the
 * pipeline itself, GeoGridKit, GeoGridWeb) vendor verbatim — see
 * `tests/fixtures/render-parity-v1/PROVENANCE.md` for this copy's source
 * commit. Nothing in this script re-derives ramp, grid, or tile math; it only
 * copies bytes and checks them against the source pack's own `manifest.json`.
 * If narduk-data's pack and its manifest disagree, that is narduk-data's bug,
 * not this script's to paper over — it fails loudly instead.
 *
 * Usage
 * -----
 *   node tests/fixtures/vendor_render_parity.mjs                # re-vendor
 *   node tests/fixtures/vendor_render_parity.mjs --check         # fail if stale
 *   node tests/fixtures/vendor_render_parity.mjs --from /path/to/narduk-data
 *   NARDUK_DATA_ROOT=/path/to/narduk-data node tests/fixtures/vendor_render_parity.mjs
 *
 * The default source is `$NARDUK_DATA_ROOT/fixtures/render-parity-v1`,
 * falling back to `~/code/narduk-enterprises/narduk-data/fixtures/render-parity-v1`.
 *
 * Re-vendoring is a deliberate local act, matching
 * `generate_ramp_parity.py`'s and `generate_tile_math_parity.sh`'s own
 * "regenerating is deliberate, review the diff" contract beside it — this is
 * not run in CI. After re-vendoring, update
 * `tests/fixtures/render-parity-v1/PROVENANCE.md` by hand with the new source
 * commit and `manifest.json` sha256; this script deliberately does not
 * rewrite that file, because the commit and date are facts about *when a
 * human reviewed the diff*, not something safe to stamp automatically.
 */

import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { copyFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url))
const DEST_DIR = join(SCRIPT_DIR, 'render-parity-v1')

function parseArgs(argv) {
  let check = false
  let from = process.env.NARDUK_DATA_ROOT ?? join(homedir(), 'code', 'narduk-enterprises', 'narduk-data')
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--check') {
      check = true
    } else if (arg === '--from') {
      index += 1
      const value = argv[index]
      if (value === undefined) throw new Error('--from requires a path')
      from = value
    } else {
      throw new Error(`unknown argument: ${arg}`)
    }
  }
  return { check, from }
}

function sha256(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex')
}

function verify(path, expected, label) {
  const bytes = readFileSync(path)
  if (bytes.byteLength !== expected.bytes) {
    return `${label}: expected ${expected.bytes} bytes, found ${bytes.byteLength}`
  }
  const digest = createHash('sha256').update(bytes).digest('hex')
  if (digest !== expected.sha256) {
    return `${label}: expected sha256 ${expected.sha256}, found ${digest}`
  }
  return null
}

function main() {
  const { check, from } = parseArgs(process.argv.slice(2))
  const sourceDir = join(from, 'fixtures', 'render-parity-v1')
  const manifestPath = join(sourceDir, 'manifest.json')

  if (!existsSync(manifestPath)) {
    console.error(`render-parity-v1 pack not found at ${sourceDir}`)
    console.error('Pass --from /path/to/narduk-data or set NARDUK_DATA_ROOT.')
    process.exitCode = 1
    return
  }

  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
  const failures = []

  for (const [relativePath, expected] of Object.entries(manifest.files)) {
    const sourcePath = join(sourceDir, relativePath)
    if (!existsSync(sourcePath)) {
      failures.push(`MISSING SOURCE: ${relativePath}`)
      continue
    }
    const sourceIssue = verify(sourcePath, expected, `source ${relativePath}`)
    if (sourceIssue) {
      failures.push(`SOURCE DRIFTED FROM ITS OWN MANIFEST — ${sourceIssue}`)
      continue
    }

    const destPath = join(DEST_DIR, relativePath)
    if (check) {
      if (!existsSync(destPath)) {
        failures.push(`MISSING VENDORED FILE: ${relativePath}`)
        continue
      }
      const destIssue = verify(destPath, expected, `vendored ${relativePath}`)
      if (destIssue) failures.push(`STALE VENDORED COPY — ${destIssue}`)
    } else {
      mkdirSync(dirname(destPath), { recursive: true })
      copyFileSync(sourcePath, destPath)
    }
  }

  // README.md documents the pack but, per the pack's own README, is
  // deliberately not manifest-pinned ("manifest.json and this README are the
  // only files not listed inside manifest.json — nothing can hash itself").
  // `--check` therefore only confirms the file EXISTS, never that its
  // CONTENT is current — there is no sha256 to check it against, by design.
  // A narduk-data-only doc change (like #311, which only touched this
  // README) can leave the vendored copy silently stale even though
  // `--check` reports success and every manifest-pinned sha256 still
  // matches. There is no automated staleness signal for this file; treat a
  // re-vendor here as an occasion to re-read the upstream README's diff by
  // hand, not just re-run this script.
  const readmeSource = join(sourceDir, 'README.md')
  const readmeDest = join(DEST_DIR, 'README.md')
  if (check) {
    if (!existsSync(readmeDest)) failures.push('MISSING VENDORED FILE: README.md')
  } else if (existsSync(readmeSource)) {
    copyFileSync(readmeSource, readmeDest)
  }

  if (failures.length > 0) {
    for (const failure of failures) console.error(failure)
    console.error(`\n${failures.length} problem(s) found.`)
    process.exitCode = 1
    return
  }

  if (check) {
    console.log(`tests/fixtures/render-parity-v1/ matches ${sourceDir}`)
    return
  }

  let sourceCommit = 'unknown'
  try {
    sourceCommit = execFileSync('git', ['-C', from, 'rev-parse', 'HEAD'], {
      encoding: 'utf8',
    }).trim()
  } catch {
    // Not a git checkout, or git is unavailable — the copy still succeeded.
  }
  console.log(`Vendored render-parity-v1 from ${sourceDir}`)
  console.log(`  narduk-data commit: ${sourceCommit}`)
  console.log(`  manifest.json sha256: ${sha256(manifestPath)}`)
  console.log(
    '\nUpdate tests/fixtures/render-parity-v1/PROVENANCE.md by hand with the commit and sha256 above, and review the diff.',
  )
}

main()
