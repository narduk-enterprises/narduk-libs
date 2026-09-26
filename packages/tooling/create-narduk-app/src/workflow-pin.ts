/**
 * Ordinary CI's shared-workflow pin, and the older pins this generator has
 * shipped. `upgrade` moves a caller forward only along this list.
 *
 * A SHA that is not on the list is left alone. That includes a pin an app
 * took from a newer `narduk-enterprises/workflows` commit than this package
 * has reviewed (gonogo, riverstatus and borderwaitstat-us all had
 * `94a3ba46`, 21 commits after `1513b2a2`). Deciding "newer" any other way
 * needs the workflows history, and this package does not call GitHub.
 *
 * When the pin in ci-workflow.ts moves, append the previous SHA here, oldest
 * first, in the same change. A pin that is not on this list is never written
 * over another pin.
 */

export const NUXT_CLOUDFLARE_WORKFLOW_SHA = '1513b2a2f4b147b2e625478e56eb9de0cc5d5399'

/** Previous values of {@link NUXT_CLOUDFLARE_WORKFLOW_SHA}, oldest first. */
export const NUXT_CLOUDFLARE_WORKFLOW_ANCESTORS = [
  '9070db7244649bf192d392a5b96eb1656997c84c',
  '4e99dafc81e09eb10c6e404f67e3ca34a17b42a6',
  '6f56678ad7562234e465284e48f27008e0f32db7',
] as const

const LINEAGE: readonly string[] = [
  ...NUXT_CLOUDFLARE_WORKFLOW_ANCESTORS,
  NUXT_CLOUDFLARE_WORKFLOW_SHA,
]

export type WorkflowPinMove = 'forward' | 'refuse' | 'same'

export function workflowPinMove(currentSha: string, desiredSha: string): WorkflowPinMove {
  if (currentSha === desiredSha) return 'same'
  const currentIndex = LINEAGE.indexOf(currentSha)
  const desiredIndex = LINEAGE.indexOf(desiredSha)
  if (currentIndex === -1 || desiredIndex === -1) return 'refuse'
  return desiredIndex > currentIndex ? 'forward' : 'refuse'
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
