/**
 * The component names the shared `@narduk-enterprises/*` packages publish, by
 * owning package (narduk-libs#260, components-library-plan.md §2 item 13).
 *
 * A static list on purpose: a lint rule cannot resolve an app's installed
 * packages, and reading them from `node_modules` would make a warning depend on
 * the install. `tests/rules/utils/shared-components-drift.test.ts` reads every
 * owner's real component files in this workspace and fails when a component is
 * added, renamed or removed without this list following. narduk-app-tools keeps
 * the same list for `foundation:check:no-local-copy` and a test there asserts
 * the two are equal.
 *
 * `sourceDir` is where the owner keeps its components, relative to the package
 * root. A file under it IS the shared component, so the shadow rule skips it —
 * without that, narduk-core's own `AppTabs.vue` would warn in narduk-libs.
 */

export interface SharedComponentOwner {
  /** Unscoped package name. */
  pkg: string
  sourceDir: string
  names: readonly string[]
}

export const SHARED_COMPONENT_OWNERS: readonly SharedComponentOwner[] = [
  {
    // Registered one by one from src/registry.ts.
    pkg: 'narduk-shell',
    sourceDir: 'src/runtime/components',
    names: [
      'NeConfirmDialog',
      'NeCsvDownload',
      'NeDataTable',
      'NeFilterBar',
      'NeForm',
      'NeFormSection',
      'NeKpiBand',
      'NeKpiTile',
      'NePageHeader',
      'NePager',
      'NeSectionHeader',
      'NeSettingsPage',
      'NeSortHeader',
      'NeStatePanel',
      'NeStatusBadge',
    ],
  },
  {
    // addComponentsDir with pathPrefix: false, so the name is the file name.
    pkg: 'narduk-core',
    sourceDir: 'runtime/app/components',
    names: [
      'AppBreadcrumbs',
      'AppConfirmModal',
      'AppCopyButton',
      'AppEmptyState',
      'AppImage',
      'AppLightbox',
      'AppSettingsProfile',
      'AppShareButtons',
      'AppSnapStrip',
      'AppTabs',
      'LayerAppFooter',
      'LayerAppHeader',
      'LayerAppShell',
      'LayerChromelessShell',
      'LayerDashboardAccountMenu',
      'LayerDashboardShell',
    ],
  },
  {
    // addComponentsDir with pathPrefix: false, so the name is the file name.
    pkg: 'narduk-auth',
    sourceDir: 'app/components',
    names: [
      'AdminUsersTab',
      'AppNotificationCenter',
      'AppUserMenu',
      'AuthApiKeysPanel',
      'AuthExchangePanel',
      'AuthLoginCard',
      'AuthPasskeysPanel',
      'AuthRegisterCard',
    ],
  },
  {
    // Imported explicitly from `@narduk-enterprises/narduk-ui/instruments`.
    pkg: 'narduk-ui',
    sourceDir: 'instruments',
    names: ['NsFreshnessChip', 'NsLevelWell', 'NsRangeBar', 'NsReadoutTile'],
  },
  {
    // Imported explicitly from `@narduk-enterprises/narduk-charts`.
    pkg: 'narduk-charts',
    sourceDir: 'src/components',
    names: [
      'NardukBarChart',
      'NardukBrandBackdrop',
      'NardukCandleChart',
      'NardukChartStack',
      'NardukHistogramChart',
      'NardukLineChart',
      'NardukPieChart',
      'NardukScatterChart',
    ],
  },
]

/** Component name → owning package. */
export const SHARED_COMPONENT_OWNER_BY_NAME: ReadonlyMap<string, SharedComponentOwner> = new Map(
  SHARED_COMPONENT_OWNERS.flatMap((owner) => owner.names.map((name) => [name, owner] as const)),
)

/** True for a file that is one of the owners' own component sources. */
export function isSharedComponentSource(filename: string): boolean {
  return SHARED_COMPONENT_OWNERS.some((owner) =>
    filename.includes(`/${owner.pkg}/${owner.sourceDir}/`),
  )
}

/** scule's `splitByCase`, which Nuxt uses to name components. */
function splitByCase(value: string): string[] {
  return value
    .split(/[-_.\s]+/)
    .flatMap((part) => part.match(/[A-Z]+(?![a-z])|[A-Z]?[a-z0-9]+/g) ?? [])
}

function pascal(parts: readonly string[]): string {
  return parts.map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join('')
}

/**
 * The name Nuxt registers for a component at `relativePath` under a
 * `components/` directory with the default `pathPrefix: true`. It follows
 * Nuxt's `resolveComponentNameSegments`: a directory segment the file name
 * already starts with is not repeated, so `app/AppHeader.vue` is `AppHeader`
 * and `ne/StatePanel.vue` is `NeStatePanel`.
 */
export function nuxtComponentName(relativePath: string): string {
  const segments = relativePath.split('/').filter(Boolean)
  const file = (segments.pop() ?? '').replace(/\.vue$/, '')
  const prefixParts = file === 'index' ? segments.slice(0, -1) : segments
  const fileName = file === 'index' ? (segments.at(-1) ?? '') : file

  const fileNameParts = splitByCase(fileName)
  const fileContent = fileNameParts.join('/').toLowerCase()
  let kept = prefixParts.length
  const matchedSuffix: string[] = []
  for (let index = prefixParts.length - 1; index >= 0; index--) {
    matchedSuffix.unshift(...splitByCase(prefixParts[index] ?? '').map((p) => p.toLowerCase()))
    const suffix = matchedSuffix.join('/')
    if (fileContent === suffix || fileContent.startsWith(`${suffix}/`)) kept = index
  }
  return pascal([...prefixParts.slice(0, kept).flatMap(splitByCase), ...fileNameParts])
}
