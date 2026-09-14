/**
 * Item 6 -- secrets and registry (spec §3 item 6, `[decided]` -- D-PKG-NPMRC-1
 * for 6.1; 6.3 is explicitly `not-applicable` while nvault adoption is
 * paused, D-ORG-1 (h)). Mirrors `check-web-foundation.py`'s static evaluator
 * exactly; nothing here needs the real checkout beyond what a manifest read
 * already gives, so this item has no app-owned sub-check.
 */

import { check } from '../schema.js'
import type { AppRepo } from '../source.js'
import { STATUS_FAIL, STATUS_NA, STATUS_PASS, type FoundationSubCheck } from '../types.js'

const NPMRC_AUTH_RE = /(?:_authToken|_auth|_password|username)\s*=/i
const ENV_FILE_CANDIDATES = ['.env', '.env.local', '.dev.vars', 'apps/web/.dev.vars'] as const

function evaluate61(repo: AppRepo): FoundationSubCheck {
  const npmrc = repo.read('.npmrc')
  if (npmrc === null) {
    return check(
      '6.1',
      'committed .npmrc carries scope lines only',
      STATUS_NA,
      'no committed .npmrc',
    )
  }
  const offenders = npmrc
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => NPMRC_AUTH_RE.test(line) && !line.startsWith('#'))
  // The line CONTENT is never printed: an auth line is the credential.
  if (offenders.length > 0) {
    return check(
      '6.1',
      'committed .npmrc carries scope lines only',
      STATUS_FAIL,
      `${offenders.length} committed .npmrc line(s) carry an auth directive (D-PKG-NPMRC-1); the line content is deliberately not printed`,
      '.npmrc',
    )
  }
  return check(
    '6.1',
    'committed .npmrc carries scope lines only',
    STATUS_PASS,
    'no auth directive in the committed .npmrc',
    '.npmrc',
  )
}

function evaluate62(repo: AppRepo): FoundationSubCheck {
  const committed = ENV_FILE_CANDIDATES.filter((rel) => repo.read(rel) !== null)
  return check(
    '6.2',
    'no committed environment/secret file',
    committed.length > 0 ? STATUS_FAIL : STATUS_PASS,
    committed.length > 0
      ? `committed: ${JSON.stringify(committed)}`
      : 'no .env / .dev.vars committed at a known path',
  )
}

function evaluate63(): FoundationSubCheck {
  return check(
    '6.3',
    'nvault selector naming',
    STATUS_NA,
    'explicitly not part of the contract while the nvault adoption project is paused (D-ORG-1 h); it joins when that project resumes',
  )
}

export function evaluateItem6(repo: AppRepo): FoundationSubCheck[] {
  return [evaluate61(repo), evaluate62(repo), evaluate63()]
}
