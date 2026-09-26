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
      'NeAdminDetailPage',
      'NeAdminEditPage',
      'NeAdminListPage',
      'NeAppShell',
      'NeCard',
      'NeCardList',
      'NeConfirmDialog',
      'NeCsvDownload',
      'NeCta',
      'NeDataAttribution',
      'NeDataTable',
      'NeDetailView',
      'NeFeatureGrid',
      'NeFilterBar',
      'NeForm',
      'NeFormSection',
      'NeHero',
      'NeKpiBand',
      'NeKpiTile',
      'NeLegalPage',
      'NeMarketingFooter',
      'NeMeter',
      'NePageHeader',
      'NePager',
      'NeProse',
      'NeSearchInput',
      'NeSectionHeader',
      'NeSettingsPage',
      'NeSkipLink',
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

const isUpper = (char: string | undefined): boolean =>
  char !== undefined && char >= 'A' && char <= 'Z'
const isLower = (char: string | undefined): boolean =>
  char !== undefined && char >= 'a' && char <= 'z'
const isDigit = (char: string | undefined): boolean =>
  char !== undefined && char >= '0' && char <= '9'

/**
 * scule's `splitByCase`, which Nuxt uses to name components: words are a
 * capital run (`HTML`) or an optional capital plus lowercase letters and
 * digits (`Parser`, `chart2`); everything else separates. A scanner rather
 * than the equivalent `/[A-Z]+(?![a-z])|[A-Z]?[a-z0-9]+/g`, which CodeQL
 * flags as polynomial on long capital runs.
 */
function splitByCase(value: string): string[] {
  const parts: string[] = []
  let start = 0
  while (start < value.length) {
    let end = start
    while (isUpper(value[end])) end++
    // A capital run followed by a lowercase letter hands its last capital to that word.
    if (end > start && isLower(value[end])) end--
    if (end === start) {
      if (isUpper(value[end])) end++
      while (isLower(value[end]) || isDigit(value[end])) end++
    }
    if (end === start) {
      start++
      continue
    }
    parts.push(value.slice(start, end))
    start = end
  }
  return parts
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
