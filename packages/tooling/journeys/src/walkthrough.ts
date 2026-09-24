import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

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
  /**
   * What to write under `--dest`. Default `both`: a complete HTML page a
   * browser can open, and a Markdown sibling GitHub will render (narduk-libs#69).
   */
  format?: 'html' | 'md' | 'both'
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
): { written: string; markdown?: string; missing: string[] } {
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
      `<ol class="beats">${steps}</ol>`,
      `<p class="outcome">${escapeHtml(journey?.outcome ?? '')}</p>`,
      manifest.video
        ? `<video controls src="${manifest.journey}/${manifest.video.file}"></video>`
        : '',
      '</section>',
    ].join('\n')
  })

  mkdirSync(options.destination, { recursive: true })
  for (const run of runs) copyPromotedMedia(run, options.destination)

  const format = options.format ?? 'both'
  const wantHtml = format !== 'md'
  const wantMd = format !== 'html'
  const htmlPath = join(options.destination, 'walkthrough.html')
  const markdownPath = join(options.destination, 'walkthrough.md')

  if (wantHtml) {
    writeFileSync(htmlPath, renderHtmlPage(options, sections))
  }
  if (wantMd) {
    writeFileSync(markdownPath, renderMarkdown(catalog, options, runs))
  }

  return {
    written: wantHtml ? htmlPath : markdownPath,
    ...(wantMd ? { markdown: markdownPath } : {}),
    missing,
  }
}

const GENERATED = '<!-- generated by @narduk-enterprises/journeys; regenerate, never edit -->'

/**
 * A page a person can open. The previous fragment had no document chrome
 * and no styles, so 2880px stills painted at full width (narduk-libs#69).
 */
const PAGE_CSS = `
:root { color-scheme: light dark; --bg: #f6f5f1; --fg: #1b1b1b; --muted: #5c5c5c; --rule: #d8d5cc; }
@media (prefers-color-scheme: dark) {
  :root { --bg: #161615; --fg: #f3f1ea; --muted: #b0aca0; --rule: #3a3934; }
}
html { background: var(--bg); color: var(--fg); }
body { margin: 0 auto; max-width: 52rem; padding: 1.5rem 1.25rem 4rem; font: 16px/1.5 ui-sans-serif, system-ui, sans-serif; }
h1, h2 { line-height: 1.2; }
.page-meta, section .meta { color: var(--muted); font-size: 0.9rem; }
.page-meta { position: sticky; top: 0; background: var(--bg); padding: 0.6rem 0; border-bottom: 1px solid var(--rule); z-index: 1; }
section { margin: 2.5rem 0; }
ol.beats { display: grid; gap: 1.5rem; padding-left: 1.25rem; }
ol.beats img, video { display: block; width: 100%; max-width: 100%; height: auto; margin-top: 0.5rem; border: 1px solid var(--rule); }
.compromises { color: var(--muted); }
.outcome { font-weight: 600; }
`.trim()

function renderHtmlPage(options: WalkthroughOptions, sections: string[]): string {
  return [
    '<!doctype html>',
    '<html lang="en">',
    '<head>',
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    `<title>Walkthrough — ${escapeHtml(options.environment)}</title>`,
    `<style>${PAGE_CSS}</style>`,
    '</head>',
    '<body>',
    GENERATED,
    `<h1>Walkthrough — ${escapeHtml(options.environment)}</h1>`,
    `<p class="meta page-meta">declaration ${escapeHtml(options.currentDigest.slice(0, 18))} · profile ${escapeHtml(
      options.profileName,
    )}</p>`,
    ...sections,
    '</body>',
    '</html>',
    '',
  ].join('\n')
}

function renderMarkdown(
  catalog: Catalog,
  options: WalkthroughOptions,
  runs: PromotedRun[],
): string {
  const lines = [
    GENERATED,
    `# Walkthrough — ${options.environment}`,
    '',
    `declaration ${options.currentDigest.slice(0, 18)} · profile ${options.profileName}`,
    '',
  ]
  for (const { manifest } of runs) {
    const journey = catalog.journeys.find((candidate) => candidate.id === manifest.journey)
    lines.push(`## ${journey?.title ?? manifest.journey}`, '')
    lines.push(
      `${manifest.surface} · as ${journey?.role ?? ''} · world ${manifest.scenario.id} · app ${
        manifest.appRevision
      } · run ${manifest.startedAt}`,
      '',
    )
    for (const compromise of journey?.compromises ?? []) {
      lines.push(`- ${compromise.what} — ${compromise.why} **Not shown:** ${compromise.cost}`)
    }
    if ((journey?.compromises ?? []).length > 0) lines.push('')
    for (const step of manifest.steps) {
      const skipped =
        step.status === 'skipped-not-applicable'
          ? ` *(not applicable: ${step.skipReason ?? ''})*`
          : ''
      lines.push(`${step.ordinal ?? ''}. ${step.say}${skipped}`)
      if (step.shot) {
        lines.push('', `   ![${step.say}](${manifest.journey}/${step.shot})`)
      }
      lines.push('')
    }
    if (journey?.outcome) {
      lines.push(journey.outcome, '')
    }
    if (manifest.video) {
      lines.push(`[video](${manifest.journey}/${manifest.video.file})`, '')
    }
  }
  return `${lines.join('\n')}\n`
}

function copyPromotedMedia(run: PromotedRun, destination: string): void {
  const destRoot = join(destination, run.manifest.journey)
  for (const step of run.manifest.steps) {
    if (!step.shot) continue
    const from = join(run.attemptDirectory, step.shot)
    if (!existsSync(from)) continue
    const to = join(destRoot, step.shot)
    mkdirSync(dirname(to), { recursive: true })
    copyFileSync(from, to)
  }
  if (!run.manifest.video) return
  const from = join(run.attemptDirectory, run.manifest.video.file)
  if (!existsSync(from)) return
  const to = join(destRoot, run.manifest.video.file)
  mkdirSync(dirname(to), { recursive: true })
  copyFileSync(from, to)
}

function escapeHtml(text: string): string {
  return text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
}
