/**
 * `narduk-app foundation:check:data-cache` -- item 15, narduk-libs#1717. See
 * `../foundation/items/item-15-public-reads-cached.js` for what it flags and
 * `../foundation/evaluate-data-cache.js` for the artefact.
 *
 * A warning in rollout mode, so one exit code:
 *   0  PASS    always. A finding prints as `[WARN]` (and as a `::warning`
 *              annotation under GitHub Actions) and sits in the artefact's
 *              `advisories` and `findings`; it never changes the exit code.
 *
 * Reads the checkout only: no registry, no Cloudflare, no credential.
 */

import { writeFileSync } from 'node:fs'

import type { FoundationCheckFlags } from './foundation-check.js'
import { readOwnVersion } from './own-version.js'
import {
  formatDataCacheSummary,
  runDataCacheCheck,
  type DataCacheArtefact,
} from '../foundation/evaluate-data-cache.js'

export function runDataCacheCheckCommand(flags: FoundationCheckFlags): {
  artefact: DataCacheArtefact
  exitCode: number
} {
  const artefact = runDataCacheCheck({ root: flags.checkoutDir, toolVersion: readOwnVersion() })
  if (flags.jsonPath) {
    writeFileSync(flags.jsonPath, JSON.stringify(artefact, null, 2) + '\n', 'utf8')
  }
  console.log(flags.json ? JSON.stringify(artefact, null, 2) : formatDataCacheSummary(artefact))
  if (process.env.GITHUB_ACTIONS === 'true' && !flags.json) {
    for (const finding of artefact.findings) {
      console.log(`::warning file=${finding.consumer ?? finding.file}::${finding.message}`)
    }
  }
  return { artefact, exitCode: artefact.exitCode }
}
