/**
 * Item 5 -- shared CI (spec §3 item 5, `[decided]` -- D-WF-1, both halves).
 *
 * 5.1's adoption-matrix fallback lives in company-hq
 * (`Config/workflow-adoption-matrix.json`), which an app's own CI cannot
 * read: spec §3 says so explicitly ("The app-side check cannot see the
 * matrix and must report that half `unknown`"). Everything else mirrors
 * `check-web-foundation.py`'s static evaluator.
 */

import { check } from '../schema.js'
import { isRecord, parseJson, type AppRepo } from '../source.js'
import { STATUS_FAIL, STATUS_PASS, STATUS_UNKNOWN, type FoundationSubCheck } from '../types.js'

const CALLABLE_PIN_RE =
  /narduk-enterprises\/workflows\/\.github\/workflows\/[\w.-]+\.yml@(?:v1|[0-9a-f]{40})/

function evaluate51(repo: AppRepo): FoundationSubCheck {
  const workflows = repo.listWorkflows()
  const pinned: string[] = []
  let unpinned = false
  for (const name of workflows) {
    const text = repo.read(`.github/workflows/${name}`) ?? ''
    if (text.includes('narduk-enterprises/workflows/.github/workflows/')) {
      if (CALLABLE_PIN_RE.test(text)) pinned.push(name)
      else unpinned = true
    }
  }
  if (pinned.length > 0) {
    return check(
      '5.1',
      'class callable pinned @v1 or a 40-char SHA',
      STATUS_PASS,
      `calls the class callable from ${JSON.stringify(pinned)}`,
      '.github/workflows',
    )
  }
  if (unpinned) {
    return check(
      '5.1',
      'class callable pinned @v1 or a 40-char SHA',
      STATUS_FAIL,
      'a workflow calls narduk-enterprises/workflows but not at @v1 or a 40-character SHA',
      '.github/workflows',
    )
  }
  return check(
    '5.1',
    'class callable, or recorded in the adoption matrix',
    STATUS_UNKNOWN,
    "no callable found in .github/workflows, and company-hq Config/workflow-adoption-matrix.json is cross-repo -- an app's own CI cannot read it (spec §3 item 5)",
  )
}

function evaluate52(repo: AppRepo): FoundationSubCheck {
  const renovate =
    parseJson(repo.read('renovate.json')) ?? parseJson(repo.read('.github/renovate.json'))
  if (!isRecord(renovate)) {
    return check(
      '5.2',
      'Renovate rule targeting @narduk-enterprises/**',
      STATUS_FAIL,
      'no renovate.json at a known path',
    )
  }
  const rules = renovate.packageRules
  const blob = Array.isArray(rules) ? JSON.stringify(rules) : ''
  if (blob.includes('narduk-enterprises')) {
    return check(
      '5.2',
      'Renovate rule targeting @narduk-enterprises/**',
      STATUS_PASS,
      'renovate.json packageRules name the @narduk-enterprises scope',
      'renovate.json',
    )
  }
  return check(
    '5.2',
    'Renovate rule targeting @narduk-enterprises/**',
    STATUS_FAIL,
    'renovate.json has no packageRule naming the @narduk-enterprises scope',
    'renovate.json',
  )
}

export function evaluateItem5(repo: AppRepo): FoundationSubCheck[] {
  return [evaluate51(repo), evaluate52(repo)]
}
