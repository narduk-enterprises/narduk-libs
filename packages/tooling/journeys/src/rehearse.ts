import type { Catalog } from './types.js'
import { expectedStepIds } from './verify.js'

export const REHEARSAL_WATERMARK =
  'REHEARSAL — generated from the declaration, no run behind it. Not evidence; not publishable.'

/**
 * The declaration-only narrative output (§2.6): prose beats and outcomes,
 * text only, watermarked. This is what a presenter rehearses from without a
 * live app; the publishable walkthrough is built from promoted capture runs
 * and lives in walkthrough.ts.
 */
export function buildRehearsal(catalog: Catalog): string {
  const lines: string[] = []
  lines.push(`> ${REHEARSAL_WATERMARK}`, '')
  for (const journey of catalog.journeys) {
    const scenarioId = journey.scenarios[0]
    const scenario = catalog.scenarios.find((candidate) => candidate.id === scenarioId)
    lines.push(`## ${journey.title}`, '')
    lines.push(
      `_${journey.surface} · as ${journey.role} · world: ${scenario?.name ?? scenarioId}_`,
      '',
    )
    const included = new Set(expectedStepIds(journey, scenarioId))
    let ordinal = 0
    for (const step of journey.steps) {
      if (!included.has(step.id)) continue
      ordinal += 1
      lines.push(`${ordinal}. ${step.say}`)
    }
    lines.push('', `**Afterwards:** ${journey.outcome}`, '')
    // A presenter rehearsing this walk is the person most likely to be asked
    // "why didn't it show the checklist?" — so a declared compromise is part of
    // the script, not a footnote in the catalog.
    for (const compromise of journey.compromises ?? []) {
      lines.push(
        `> **Compromise:** ${compromise.what} — ${compromise.why} ` +
          `Not shown: ${compromise.cost}`,
        '',
      )
    }
  }
  lines.push(`> ${REHEARSAL_WATERMARK}`)
  return lines.join('\n')
}
