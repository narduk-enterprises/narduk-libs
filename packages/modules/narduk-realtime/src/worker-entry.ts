import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

/**
 * Nuxt builds Nitro twice: once for the prerenderer and once for the deployment
 * preset. Only the preset build produces the Cloudflare Worker entry with a
 * `default` export; the prerenderer entry has none, so re-exporting `default`
 * from it would fail the build. This marker is what distinguishes them.
 */
export const CLOUDFLARE_PRESET_ENTRY_MARKER = '/presets/cloudflare/'

/** Name of the generated entry written into the Nitro build directory. */
export const WORKER_ENTRY_FILENAME = 'narduk-realtime-worker-entry.mjs'

/** The subset of the Nitro instance this module reads. */
export interface NitroEntryContext {
  options: {
    buildDir: string
    entry: string
  }
}

/** The subset of the rollup config this module writes. */
export interface RollupEntryConfig {
  input?: unknown
}

/** A resolved Durable Object: exported class name to absolute module path. */
export interface ResolvedDurableObject {
  className: string
  modulePath: string
}

/** A validated `realtime.upgrades` entry, ready to emit into the entry. */
export interface ResolvedUpgrade {
  path: string
  binding: string
  idFrom: string
  forwardHeaders: string[]
  authorizeModulePath?: string
}

/**
 * Specifier the generated entry imports the runtime router from.
 *
 * A bare specifier, resolved from the *app's* `node_modules` by the Nitro
 * bundler, rather than an absolute path into this package's own install
 * location: the generated file lives inside the app's build directory, and the
 * app depends on this package, so this is the resolution the rest of its module
 * graph already uses.
 */
export const UPGRADE_ROUTER_MODULE = '@narduk-enterprises/narduk-realtime/worker/upgrade-router'

/** Prefix for the generated identifiers, kept clear of anything Nitro emits. */
const GENERATED_PREFIX = 'nardukRealtime'

function upgradeAuthorizerName(index: number): string {
  return `${GENERATED_PREFIX}Authorize${index}`
}

/**
 * Emit the `upgrades` array literal for the router configuration.
 *
 * Every value is a validated string emitted through `JSON.stringify`; the only
 * live reference is the authoriser's imported binding, which is why this is
 * generated rather than serialised whole.
 */
function upgradeEntries(upgrades: readonly ResolvedUpgrade[]): string[] {
  return upgrades.flatMap((upgrade, index) => [
    '    {',
    `      path: ${JSON.stringify(upgrade.path)},`,
    `      binding: ${JSON.stringify(upgrade.binding)},`,
    `      idFrom: ${JSON.stringify(upgrade.idFrom)},`,
    `      forwardHeaders: ${JSON.stringify(upgrade.forwardHeaders)},`,
    ...(upgrade.authorizeModulePath === undefined
      ? []
      : [`      authorize: ${upgradeAuthorizerName(index)},`]),
    '    },',
  ])
}

/**
 * Compose the generated Worker entry.
 *
 * Nitro pins the entry chunk name to `index.mjs`, so wrapping its entry this way
 * leaves the wrangler `main` path unchanged; the built Worker simply gains one
 * named export per Durable Object class alongside the default fetch handler.
 *
 * With no `upgrades` declared the entry re-exports Nitro's `default` untouched.
 * With upgrades it imports that default instead and exports it wrapped in the
 * upgrade router, so a matching `Upgrade: websocket` request is authorised and
 * handed to a Durable Object *before* Nitro's `localFetch` -- which cannot carry
 * a 101 -- ever sees it. Every other request, upgrade or not, reaches Nitro
 * exactly as it would have.
 */
export function buildWorkerEntrySource(
  nitroEntry: string,
  durableObjects: readonly ResolvedDurableObject[],
  upgrades: readonly ResolvedUpgrade[] = [],
): string {
  const classExports = durableObjects.map(
    ({ className, modulePath }) => `export { ${className} } from ${JSON.stringify(modulePath)}`,
  )

  if (upgrades.length === 0) {
    return [`export { default } from ${JSON.stringify(nitroEntry)}`, ...classExports, ''].join('\n')
  }

  return [
    'import { useNitroApp } from "nitropack/runtime"',
    `import { createUpgradeRouter, withUpgradeRouter } from ${JSON.stringify(UPGRADE_ROUTER_MODULE)}`,
    `import ${GENERATED_PREFIX}Handler from ${JSON.stringify(nitroEntry)}`,
    ...upgrades.flatMap((upgrade, index) =>
      upgrade.authorizeModulePath === undefined
        ? []
        : [
            `import ${upgradeAuthorizerName(index)} from ${JSON.stringify(
              upgrade.authorizeModulePath,
            )}`,
          ],
    ),
    ...classExports,
    '',
    `const ${GENERATED_PREFIX}Router = createUpgradeRouter({`,
    // Resolved per call rather than at module scope: the Nitro app is created by
    // the entry imported above, and a lazy lookup owes nothing to import order.
    '  localFetch: (path, init) => useNitroApp().localFetch(path, init),',
    '  upgrades: [',
    ...upgradeEntries(upgrades),
    '  ],',
    '})',
    '',
    `export default withUpgradeRouter(${GENERATED_PREFIX}Handler, ${GENERATED_PREFIX}Router)`,
    '',
  ].join('\n')
}

/**
 * Build the Nitro `rollup:before` handler that re-exports every declared
 * Durable Object class from the Cloudflare Worker entry.
 *
 * The handler is a no-op for any Nitro build that is not the Cloudflare preset
 * build, and a no-op when no Durable Objects are declared.
 */
export function createWorkerEntryHook(
  durableObjects: readonly ResolvedDurableObject[],
  upgrades: readonly ResolvedUpgrade[] = [],
): (nitro: NitroEntryContext, rollupConfig: RollupEntryConfig) => void {
  return (nitro, rollupConfig) => {
    if (durableObjects.length === 0 && upgrades.length === 0) return
    if (!nitro.options.entry.includes(CLOUDFLARE_PRESET_ENTRY_MARKER)) return

    const entryPath = join(nitro.options.buildDir, WORKER_ENTRY_FILENAME)
    mkdirSync(dirname(entryPath), { recursive: true })
    writeFileSync(
      entryPath,
      buildWorkerEntrySource(nitro.options.entry, durableObjects, upgrades),
      'utf8',
    )
    rollupConfig.input = entryPath
  }
}
