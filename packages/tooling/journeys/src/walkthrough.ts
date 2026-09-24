import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import type { Catalog, RunManifest, Surface } from './types.js'
import { readRunManifest, runPaths, verifyRun } from './verify.js'

export interface WalkthroughOptions {
  outRoot: string
  environment: string
  /** The profile a surface uses when `profileNames` names none. */
  profileName: string
  /**
   * Per-surface profile names. A catalog that declares journeys on web AND on
   * a handset has two capture profiles, and the walkthrough is the one output
   * that must read both: this is what makes one journey run publish both
   * surfaces instead of the web half only.
   */
  profileNames?: Partial<Record<Surface, string>>
  /**
   * Per-surface environments, for the same reason and a step further: a web
   * journey runs against a deployment and a handset journey runs against an
   * in-app fixture world, so their runs file under different environment names
   * by construction. Without this the two halves of one story could never be
   * assembled onto one page.
   */
  environments?: Partial<Record<Surface, string>>
  currentDigest: string
  /** Where the walkthrough page lands. */
  destination: string
  /**
   * Explicit override for assembling runs whose appRevision disagree (§4.3).
   * The check is PER SURFACE: a walkthrough is evidence about one revision of
   * one application, and the web app and the phone app are two applications
   * with two version schemes. Requiring an override for every cross-surface
   * page would turn the guard into noise, which is how a guard stops being
   * read.
   */
  allowMixedAppRevision?: boolean
}

interface PromotedRun {
  manifest: RunManifest
  attemptDirectory: string
}

/**
 * The publishable narrative output (§2.6, §4.3): built only from PROMOTED,
 * passed, capture-mode runs whose journey digest equals that journey as it
 * stands now (or, for older manifests, whose declaration digest equals the
 * catalog), and refusing to mix application revisions without an explicit
 * override. A journey with no promoted capture is reported, never silently
 * absent.
 */
export function buildWalkthrough(
  catalog: Catalog,
  options: WalkthroughOptions,
): { written: string; missing: string[] } {
  const runs: PromotedRun[] = []
  const missing: string[] = []
  for (const journey of catalog.journeys) {
    const profileName = options.profileNames?.[journey.surface] ?? options.profileName
    const profile = catalog.profiles[profileName]
    const wantedKind = journey.surface === 'web' ? 'web' : 'apple'
    if (!profile || profile.kind !== wantedKind) {
      missing.push(
        `${journey.id}: no ${wantedKind} capture profile for surface "${journey.surface}" ` +
          `(resolved "${profileName}")`,
      )
      continue
    }
    const paths = runPaths({
      outRoot: options.outRoot,
      environment: options.environments?.[journey.surface] ?? options.environment,
      surface: journey.surface,
      journeyId: journey.id,
      profileName,
      mode: 'capture',
      runId: 'unused',
    })
    if (!existsSync(paths.latestPath)) {
      missing.push(`${journey.id}: no promoted capture run`)
      continue
    }
    const runId = readFileSync(paths.latestPath, 'utf8').trim()
    const attemptDirectory = join(paths.modeDirectory, 'runs', runId)
    const manifest = readRunManifest(attemptDirectory)
    if (manifest.mode !== 'capture') {
      throw new Error(`${journey.id}: promoted latest is not a capture run`)
    }
    if (manifest.verdict !== 'passed') {
      throw new Error(`${journey.id}: promoted latest did not pass`)
    }
    const issues = verifyRun(catalog, manifest, attemptDirectory, {
      currentDigest: options.currentDigest,
    })
    if (issues.length > 0) {
      throw new Error(`${journey.id}: promoted run fails verification:\n- ${issues.join('\n- ')}`)
    }
    runs.push({ manifest, attemptDirectory })
  }

  if (!options.allowMixedAppRevision) {
    const bySurface = new Map<Surface, Set<string>>()
    for (const run of runs) {
      const seen = bySurface.get(run.manifest.surface) ?? new Set<string>()
      seen.add(run.manifest.appRevision)
      bySurface.set(run.manifest.surface, seen)
    }
    for (const [surface, revisions] of bySurface) {
      if (revisions.size > 1) {
        throw new Error(
          `refusing to assemble a walkthrough across ${surface} application revisions ` +
            `[${[...revisions].join(', ')}] without an explicit override: a walkthrough is ` +
            'evidence about one revision, not a collage',
        )
      }
    }
  }

  const sections = runs.map(({ manifest }) => {
    const journey = catalog.journeys.find((candidate) => candidate.id === manifest.journey)
    const steps = manifest.steps
      .map((step) => {
        const shot = step.shot
          ? `<img src="${manifest.journey}/${step.shot}" alt="${escapeHtml(step.say)}" loading="lazy">`
          : ''
        const skipped =
          step.status === 'skipped-not-applicable'
            ? ` <em>(not applicable: ${escapeHtml(step.skipReason ?? '')})</em>`
            : ''
        return `<li><p>${escapeHtml(step.say)}${skipped}</p>${shot}</li>`
      })
      .join('\n')
    const compromises = (journey?.compromises ?? [])
      .map(
        (compromise) =>
          `<li>${escapeHtml(compromise.what)} — ${escapeHtml(compromise.why)} ` +
          `<strong>Not shown:</strong> ${escapeHtml(compromise.cost)}</li>`,
      )
      .join('\n')
    return [
      `<section id="${manifest.journey}">`,
      `<h2>${escapeHtml(journey?.title ?? manifest.journey)}</h2>`,
      `<p class="meta">${escapeHtml(manifest.surface)} · as ${escapeHtml(
        journey?.role ?? '',
      )} · world ${escapeHtml(manifest.scenario.id)} · app ${escapeHtml(
        manifest.appRevision,
      )} · run ${escapeHtml(manifest.startedAt)}</p>`,
      // A declared compromise travels WITH the evidence it changed. A viewer who
      // is not told what a capture withheld is being shown a fuller product than
      // the one that ran (narduk-libs#70).
      compromises ? `<ul class="compromises">${compromises}</ul>` : '',
      `<ol>${steps}</ol>`,
      `<p class="outcome">${escapeHtml(journey?.outcome ?? '')}</p>`,
      manifest.video
        ? `<video controls src="${manifest.journey}/${manifest.video.file}"></video>`
        : '',
      '</section>',
    ].join('\n')
  })

  const html = [
    '<!-- generated by @narduk-enterprises/journeys; regenerate, never edit -->',
    `<h1>Walkthrough — ${escapeHtml(options.environment)}</h1>`,
    `<p class="meta">declaration ${escapeHtml(options.currentDigest.slice(0, 18))} · profile ${escapeHtml(
      options.profileName,
    )}</p>`,
    ...sections,
  ].join('\n')

  mkdirSync(join(options.destination), { recursive: true })
  const written = join(options.destination, 'walkthrough.html')
  writeFileSync(written, html)
  return { written, missing }
}

function escapeHtml(text: string): string {
  return text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
}
