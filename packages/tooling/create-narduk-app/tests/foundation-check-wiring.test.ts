/**
 * `foundation:check:shared-ui-pinned` has to actually RUN somewhere
 * (narduk-libs#277 and #282 review, task 4: "a command nothing runs").
 *
 * Where it runs, and why here:
 *
 * - The generated app's `quality:static` chain. The public generated CI runs
 *   `pnpm run quality:static` directly, and every developer reaches it through
 *   `pnpm run quality`.
 * - narduk-libs' own `packed-consumer-smoke` job, for free:
 *   `scripts/consumer-smoke-phases.mjs` `qualityPhases()` expands the generated
 *   app's `quality` script into phases, recursing through every segment that is
 *   a plain `pnpm run <script>` call. So the check runs against a
 *   really-installed generated app on every narduk-libs PR -- which is why the
 *   segment shape below is asserted, not just its presence.
 * - The PRIVATE generated CI calls the shared `nuxt-cloudflare.yml` workflow
 *   with a curated `extra-scripts` list rather than `quality:static`; adding
 *   the script name there is a `ci-workflow.ts` change handed to the
 *   integrator, and is NOT covered by this file.
 *
 * The command must stay credential-free for any of this to work: the generated
 * install step scopes the GitHub Packages token to `pnpm install` alone, so
 * nothing later in the job has an ambient token.
 */

import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

import { buildGeneratedFiles, SUPPORTED_CAPABILITIES, type Capability } from '../src/index.js'

/** The exact segment grammar `scripts/consumer-smoke-phases.mjs` recurses
 * into. A segment it cannot parse is run as one opaque phase, which would
 * silently stop expanding the rest of the chain. */
const PLAIN_PNPM_RUN = /^pnpm run [\w:-]+$/

function manifests(capabilities: readonly Capability[]): {
  root: { scripts: Record<string, string> }
  web: { scripts: Record<string, string> }
} {
  const files = new Map(
    buildGeneratedFiles({
      appName: 'wiring-fixture',
      capabilities: [...capabilities],
      visibility: 'private',
      targetDir: '/tmp/wiring-fixture',
    }).map((file) => [file.path, file.contents]),
  )
  const read = (path: string) =>
    JSON.parse(files.get(path) ?? '{}') as { scripts: Record<string, string> }
  return { root: read('package.json'), web: read('apps/web/package.json') }
}

describe('generated apps run foundation:check:shared-ui-pinned', () => {
  it('the web package invokes the command against the whole checkout', () => {
    const { web } = manifests(['auth'])
    expect(web.scripts['foundation:shared-ui-pinned']).toBe(
      'narduk-app foundation:check:shared-ui-pinned --checkout ../..',
    )
  })

  it('the root package delegates to it', () => {
    const { root } = manifests(['auth'])
    expect(root.scripts['foundation:shared-ui-pinned']).toBe(
      'pnpm --filter web run foundation:shared-ui-pinned',
    )
  })

  it.each([
    { label: 'every capability', capabilities: [...SUPPORTED_CAPABILITIES] },
    { label: 'no capability', capabilities: [] as Capability[] },
  ])('$label: quality:static includes the check', ({ capabilities }) => {
    const { root } = manifests(capabilities)
    expect(root.scripts['quality:static'].split(' && ')).toContain(
      'pnpm run foundation:shared-ui-pinned',
    )
  })

  it('quality reaches it, and every segment stays expandable by qualityPhases', () => {
    const { root } = manifests(['seo'])
    for (const script of ['quality', 'quality:static']) {
      for (const segment of root.scripts[script].split(' && ')) {
        expect(segment, `${script} segment ${JSON.stringify(segment)}`).toMatch(PLAIN_PNPM_RUN)
      }
    }
    expect(root.scripts.quality.split(' && ')).toContain('pnpm run quality:static')
  })

  it('runs before the expensive phases so a bad pin fails fast', () => {
    const segments = manifests(['seo']).root.scripts['quality:static'].split(' && ')
    expect(segments.indexOf('pnpm run foundation:shared-ui-pinned')).toBeLessThan(
      segments.indexOf('pnpm run build:ci'),
    )
  })
})

describe('every foundation check the web package runs reads the repository root', () => {
  // pnpm runs apps/web scripts with the cwd at apps/web. `--checkout ..` was
  // apps/, where item 12 found no Config/ and reported N/A with exit 0
  // (narduk-libs#679).
  it.each([
    { label: 'every capability', capabilities: [...SUPPORTED_CAPABILITIES] },
    { label: 'no capability', capabilities: [] as Capability[] },
  ])('$label', ({ capabilities }) => {
    const { web } = manifests(capabilities)
    const checkouts = Object.entries(web.scripts).flatMap(([name, script]) =>
      [...script.matchAll(/--checkout\s+(\S+)/g)].map((match) => ({ name, checkout: match[1] })),
    )

    expect(checkouts.map(({ name }) => name).sort()).toEqual([
      'foundation:deployment',
      'foundation:shared-ui-pinned',
    ])
    for (const { name, checkout } of checkouts) {
      expect(resolve('/repo/apps/web', checkout ?? ''), name).toBe('/repo')
    }
  })
})
