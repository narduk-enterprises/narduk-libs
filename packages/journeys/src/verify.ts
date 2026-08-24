import { createHash } from 'node:crypto'
import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import type { Catalog, Journey, Mode, RunManifest } from './types.js'
import { RUN_SCHEMA } from './types.js'

/**
 * The declared step-id sequence for one (journey, scenario): static `skipWhen`
 * resolved up front. This is the specification promotion verifies a manifest
 * against — expectations always come from the declaration, never from the
 * manifest under test (§4.3).
 */
export function expectedStepIds(journey: Journey, scenarioId: string): string[] {
  if (!journey.scenarios.includes(scenarioId)) {
    throw new Error(`journey "${journey.id}" does not declare scenario "${scenarioId}"`)
  }
  return journey.steps
    .filter((step) => !step.skipWhen?.scenarios.includes(scenarioId))
    .map((step) => step.id)
}

export interface VerifyOptions {
  /** The digest of the catalog as it stands NOW. Promotion requires equality. */
  currentDigest?: string
}

function sha256(buffer: Buffer): string {
  return `sha256:${createHash('sha256').update(buffer).digest('hex')}`
}

/**
 * Verify one run attempt against the declaration (§4.3). Returns every issue
 * found; an empty list is the only pass. The manifest is evidence — it is
 * never the specification of its own completeness.
 */
export function verifyRun(
  catalog: Catalog,
  manifest: RunManifest,
  runDirectory: string,
  options: VerifyOptions = {},
): string[] {
  const issues: string[] = []
  if (manifest.schema !== RUN_SCHEMA) {
    return [`unknown run schema "${manifest.schema}" (expected "${RUN_SCHEMA}")`]
  }
  const journey = catalog.journeys.find((candidate) => candidate.id === manifest.journey)
  if (!journey) return [`manifest names unknown journey "${manifest.journey}"`]
  if (journey.surface !== manifest.surface) {
    issues.push(`manifest surface "${manifest.surface}" != declared "${journey.surface}"`)
  }
  if (!catalog.profiles[manifest.profile.name]) {
    issues.push(`manifest names unknown profile "${manifest.profile.name}"`)
  }

  let expected: string[]
  try {
    expected = expectedStepIds(journey, manifest.scenario.id)
  } catch (error) {
    return [error instanceof Error ? error.message : String(error)]
  }

  if (!manifest.scenario.confirmed) {
    issues.push('the world never confirmed the scenario by name')
  }
  if (manifest.scenario.generationAfter !== manifest.scenario.generation) {
    issues.push(
      `world generation changed mid-run ("${manifest.scenario.generation}" to ` +
        `"${manifest.scenario.generationAfter}") — the world was replaced under the journey`,
    )
  }

  // Exact sequence equality against the declaration (§4.3): a manifest that
  // omitted a declared step fails here, whatever it attests about itself.
  const executedIds = manifest.steps.map((step) => step.id)
  if (executedIds.join(' ') !== expected.join(' ')) {
    issues.push(
      `manifest step sequence [${executedIds.join(', ')}] does not equal declared ` +
        `sequence [${expected.join(', ')}] for scenario "${manifest.scenario.id}"`,
    )
  }

  const declaredSteps = new Map(journey.steps.map((step) => [step.id, step]))
  for (const [index, step] of manifest.steps.entries()) {
    if (step.ordinal !== index + 1) {
      issues.push(`step "${step.id}": ordinal ${step.ordinal} out of order`)
    }
    const declared = declaredSteps.get(step.id)
    if (!declared) continue
    if (declared.say !== step.say) {
      issues.push(`step "${step.id}": manifest prose diverges from the declaration`)
    }
    if (step.status === 'skipped-not-applicable') {
      const declaresProbe =
        journey.surface === 'web' && 'appliesIf' in declared && declared.appliesIf
      if (!declaresProbe) {
        issues.push(`step "${step.id}": dynamic skip on a step that declares no appliesIf`)
      }
      if (!step.skipReason?.trim()) {
        issues.push(`step "${step.id}": dynamic skip carries no recorded reason`)
      }
    }
    if (manifest.mode === 'capture' && step.status === 'passed') {
      if (!step.shot || !step.shotSha256) {
        issues.push(`step "${step.id}": capture mode requires a shot and its hash`)
      } else {
        const shotPath = join(runDirectory, step.shot)
        if (!existsSync(shotPath)) {
          issues.push(`step "${step.id}": shot file missing (${step.shot})`)
        } else if (sha256(readFileSync(shotPath)) !== step.shotSha256) {
          issues.push(`step "${step.id}": shot hash mismatch (${step.shot})`)
        }
      }
    }
  }

  const failedSteps = manifest.steps.filter((step) => step.status === 'failed')
  if (manifest.verdict === 'passed' && failedSteps.length > 0) {
    issues.push('verdict says passed while a step recorded failed')
  }

  if (manifest.mode === 'capture') {
    if (!manifest.video) {
      issues.push('capture mode requires a video')
    } else {
      const videoPath = join(runDirectory, manifest.video.file)
      if (!existsSync(videoPath)) {
        issues.push(`video file missing (${manifest.video.file})`)
      } else if (sha256(readFileSync(videoPath)) !== manifest.video.sha256) {
        issues.push(`video hash mismatch (${manifest.video.file})`)
      }
    }
  }

  if (options.currentDigest !== undefined && options.currentDigest !== manifest.declarationDigest) {
    issues.push(
      'declaration digest mismatch: this run executed a catalog that has since changed ' +
        '(an internally consistent stale run fails promotion)',
    )
  }
  return issues
}

/**
 * Promote a verified, passed run: atomically point `latest` (per journey,
 * profile, mode — the pointer file lives beside `runs/`) at this attempt.
 */
export function promoteRun(
  catalog: Catalog,
  manifest: RunManifest,
  runDirectory: string,
  options: VerifyOptions & { runId: string; latestPath: string },
): void {
  const issues = verifyRun(catalog, manifest, runDirectory, options)
  if (options.currentDigest === undefined) {
    issues.push('promotion requires the current declaration digest')
  }
  if (manifest.verdict !== 'passed') {
    issues.push(`only a passed run can be promoted (verdict: ${manifest.verdict})`)
  }
  if (issues.length > 0) {
    throw new Error(`refusing to promote:\n- ${issues.join('\n- ')}`)
  }
  const temporary = `${options.latestPath}.tmp-${process.pid}`
  writeFileSync(temporary, `${options.runId}\n`)
  renameSync(temporary, options.latestPath)
}

/** Read and minimally shape-check a run manifest from an attempt directory. */
export function readRunManifest(runDirectory: string): RunManifest {
  const manifestPath = join(runDirectory, 'run.json')
  const parsed: unknown = JSON.parse(readFileSync(manifestPath, 'utf8'))
  if (typeof parsed !== 'object' || parsed === null || !('schema' in parsed)) {
    throw new Error(`${manifestPath} is not a run manifest`)
  }
  return parsed as RunManifest
}

/** The canonical attempt-directory layout (§4.3). */
export function runPaths(options: {
  outRoot: string
  environment: string
  surface: string
  journeyId: string
  profileName: string
  mode: Mode
  runId: string
}): { attemptDirectory: string; latestPath: string; modeDirectory: string } {
  const modeDirectory = join(
    options.outRoot,
    options.environment,
    options.surface,
    options.journeyId,
    options.profileName,
    options.mode,
  )
  return {
    modeDirectory,
    attemptDirectory: join(modeDirectory, 'runs', options.runId),
    latestPath: join(modeDirectory, 'latest'),
  }
}
