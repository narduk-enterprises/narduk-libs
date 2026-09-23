/**
 * Component names the shared `@narduk-enterprises/*` packages publish, for
 * item 13 `no-local-copy` (narduk-libs#260).
 *
 * The same list as eslint-config's `src/rules/utils/shared-components.ts`,
 * whose test checks the list against each owner's real component files.
 * narduk-app-tools takes no runtime dependency on eslint-config, so the list
 * is repeated here, and `tests/foundation/item-13-no-local-copy.test.ts`
 * asserts that the two lists are equal.
 */

export interface SharedComponentOwner {
  /** Scoped package name. */
  pkg: string
  names: readonly string[]
}

export const SHARED_COMPONENT_OWNERS: readonly SharedComponentOwner[] = [
  {
    pkg: '@narduk-enterprises/narduk-shell',
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
    pkg: '@narduk-enterprises/narduk-core',
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
    pkg: '@narduk-enterprises/narduk-auth',
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
    pkg: '@narduk-enterprises/narduk-ui',
    names: ['NsFreshnessChip', 'NsLevelWell', 'NsRangeBar', 'NsReadoutTile'],
  },
  {
    pkg: '@narduk-enterprises/narduk-charts',
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
 * `components/` directory with the default `pathPrefix: true`, following
 * Nuxt's `resolveComponentNameSegments`: `app/AppHeader.vue` is `AppHeader`,
 * `ne/StatePanel.vue` is `NeStatePanel`.
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
