/**
 * Ordinary CI's shared-workflow pin, and the older pins this generator has
 * shipped. `upgrade` moves a caller forward when {@link workflowPinMove}
 * can see that the app's SHA is an ancestor of this pin in the bundled
 * workflows history (`workflow-history.ts`). A descendant is left where the
 * app put it. A SHA that history does not contain is not clean and is not
 * rewritten.
 *
 * When the pin in ci-workflow.ts moves, append the previous SHA here, oldest
 * first, and refresh `workflow-history.ts` through the workflows `main` that
 * contains the new pin. A pin that is not an ancestor of the desired SHA is
 * never written over another pin.
 */

import { WORKFLOWS_MAIN_PARENTS } from './workflow-history.js'

export const NUXT_CLOUDFLARE_WORKFLOW_SHA = '1513b2a2f4b147b2e625478e56eb9de0cc5d5399'

/** Previous values of {@link NUXT_CLOUDFLARE_WORKFLOW_SHA}, oldest first. */
export const NUXT_CLOUDFLARE_WORKFLOW_ANCESTORS = [
  '9070db7244649bf192d392a5b96eb1656997c84c',
  '4e99dafc81e09eb10c6e404f67e3ca34a17b42a6',
  '6f56678ad7562234e465284e48f27008e0f32db7',
] as const

export type WorkflowPinMove = 'forward' | 'refuse' | 'same' | 'unknown'

function workflowsCommitKnown(sha: string): boolean {
  return Object.prototype.hasOwnProperty.call(WORKFLOWS_MAIN_PARENTS, sha)
}

function workflowsIsAncestor(ancestor: string, descendant: string): boolean {
  if (!workflowsCommitKnown(ancestor) || !workflowsCommitKnown(descendant)) return false
  if (ancestor === descendant) return true
  const seen = new Set<string>()
  const stack = [...(WORKFLOWS_MAIN_PARENTS[descendant] ?? [])]
  while (stack.length > 0) {
    const parent = stack.pop()
    if (!parent || seen.has(parent)) continue
    if (parent === ancestor) return true
    seen.add(parent)
    const parents = WORKFLOWS_MAIN_PARENTS[parent]
    if (parents) stack.push(...parents)
  }
  return false
}

export function workflowPinMove(currentSha: string, desiredSha: string): WorkflowPinMove {
  if (currentSha === desiredSha) return 'same'
  if (!workflowsCommitKnown(currentSha) || !workflowsCommitKnown(desiredSha)) return 'unknown'
  if (workflowsIsAncestor(currentSha, desiredSha)) return 'forward'
  if (workflowsIsAncestor(desiredSha, currentSha)) return 'refuse'
  return 'unknown'
}

const CALLER_PIN =
  /narduk-enterprises\/workflows\/\.github\/workflows\/nuxt-cloudflare\.yml@[0-9a-f]{40}/gu

/**
 * Replaces caller pins with `desiredSha` and moves a `workflows@<prefix>`
 * comment onto that same SHA. A comment whose hex is already a prefix of
 * the desired SHA is left alone.
 */
export function rewriteWorkflowPins(contents: string, desiredSha: string): string {
  const desiredPin =
    'narduk-enterprises/workflows/.github/workflows/nuxt-cloudflare.yml@' + desiredSha
  const oldShas = new Set<string>()
  const rewritten = contents.replaceAll(CALLER_PIN, (pin) => {
    const sha = pin.slice(pin.lastIndexOf('@') + 1)
    if (sha === desiredSha) return pin
    oldShas.add(sha)
    return desiredPin
  })
  if (oldShas.size === 0) return rewritten
  return rewritten.replaceAll(/workflows@[0-9a-f]{7,40}/gu, (match) => {
    const hex = match.slice('workflows@'.length)
    if (desiredSha.startsWith(hex)) return match
    for (const oldSha of oldShas) {
      if (oldSha.startsWith(hex)) return 'workflows@' + desiredSha.slice(0, hex.length)
    }
    return match
  })
}
