/**
 * Item 4 -- no forks of package-owned behaviour (spec §3 item 4).
 *
 * 4.1/4.3 mirror `check-web-foundation.py`'s static evaluator exactly. 4.2 is
 * what this tool owns: "the #76 Wave-1 file list ships with narduk-app-tools;
 * a content-hash comparison is that tool's job, not a manifest read."
 */

import { check } from '../schema.js'
import { normalizedContentHash } from '../content-hash.js'
import { collectPackages, mergedDeps, type AppRepo } from '../source.js'
import {
  WAVE1_FORK_LIST,
  WAVE1_SCAN_DIRS,
  WAVE1_SCAN_EXTENSIONS,
  type Wave1ForkEntry,
} from '../wave1-file-list.js'
import { STATUS_FAIL, STATUS_PASS, STATUS_UNKNOWN, type FoundationSubCheck } from '../types.js'

const TEMPLATE_LAYER_RE = /^@narduk-enterprises\/narduk-nuxt-template-layer-/
const FORBIDDEN_PACKAGES = ['@narduk-enterprises/narduk-cli'] as const

function evaluate41And43(
  merged: Record<string, string>,
  where: string,
): [FoundationSubCheck, FoundationSubCheck] {
  const layers = Object.keys(merged)
    .filter((name) => TEMPLATE_LAYER_RE.test(name) || name.includes('narduk-nuxt-template-layer'))
    .sort()
  const forbidden = Object.keys(merged)
    .filter((name) => (FORBIDDEN_PACKAGES as readonly string[]).includes(name))
    .sort()
  return [
    check(
      '4.1',
      'no narduk-nuxt-template-layer-* dependency',
      layers.length > 0 ? STATUS_FAIL : STATUS_PASS,
      layers.length > 0
        ? `template layer dependency: ${JSON.stringify(layers)}`
        : 'no template-layer dependency',
      where,
    ),
    check(
      '4.3',
      'no narduk-cli dependency',
      forbidden.length > 0 ? STATUS_FAIL : STATUS_PASS,
      forbidden.length > 0
        ? `forbidden dependency: ${JSON.stringify(forbidden)}`
        : 'no narduk-cli dependency',
      where,
    ),
  ]
}

/** `forkList` is injectable so tests can seed a deterministic, fully-known
 * fixture-to-fingerprint match without embedding a real client repo's source
 * into this package -- the real list (`WAVE1_FORK_LIST`) is verified against
 * the actual #76 client checkouts out of band (see that module's header). */
export function evaluate42(
  repo: AppRepo,
  forkList: readonly Wave1ForkEntry[] = WAVE1_FORK_LIST,
): FoundationSubCheck {
  const knownHashes = new Map(forkList.map((entry) => [entry.sha256, entry]))
  const matches: string[] = []
  let scanned = 0
  for (const dir of WAVE1_SCAN_DIRS) {
    for (const rel of repo.walk(dir, WAVE1_SCAN_EXTENSIONS)) {
      scanned += 1
      const text = repo.read(rel)
      if (!text) continue
      const hash = normalizedContentHash(text)
      const entry = knownHashes.get(hash)
      if (entry) matches.push(`${rel} matches known fork "${entry.id}" (owned by ${entry.ownedBy})`)
    }
  }
  if (matches.length > 0) {
    return check(
      '4.2',
      'no local copy of package-owned behaviour (#76 Wave-1 file list)',
      STATUS_FAIL,
      matches.join('; '),
      matches[0].split(' matches')[0],
    )
  }
  return check(
    '4.2',
    'no local copy of package-owned behaviour (#76 Wave-1 file list)',
    STATUS_PASS,
    `scanned ${scanned} file(s) under ${WAVE1_SCAN_DIRS.join(', ')} against ${forkList.length} known fork fingerprint(s); no match`,
  )
}

export function evaluateItem4(
  repo: AppRepo,
  forkList: readonly Wave1ForkEntry[] = WAVE1_FORK_LIST,
): FoundationSubCheck[] {
  const packages = collectPackages(repo)
  if (packages.length === 0) {
    return [
      check(
        '4.0',
        'no forks of package-owned behaviour',
        STATUS_UNKNOWN,
        'no package.json readable at a known path',
      ),
    ]
  }
  const merged = mergedDeps(packages)
  const where = packages.map((p) => p.rel).join(', ')
  const [c41, c43] = evaluate41And43(merged, where)
  return [c41, evaluate42(repo, forkList), c43]
}
