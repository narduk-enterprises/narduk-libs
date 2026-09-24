/**
 * The Explorer's example registry: plain data, no Vue.
 *
 * Each entry is one demo page with a stable id (its URL), the package that
 * owns it, and how it is drawn:
 *
 * - `card` names a package-owned NE Base design card
 *   (`narduk-shell/src/design-cards/<card>.card.vue`) rendered as the baseline
 *   preview. The Explorer never re-authors what a card already shows.
 * - `interactive: true` means `app/examples/<id>.vue` exists: a wrapper around
 *   the real component with curated controls, URL-encoded presets and an
 *   event log.
 * - Every example has `app/usage/<id>.usage.vue`: a complete, minimal
 *   consumer example (the suffix keeps the file from shadowing the component
 *   it shows). It is a real SFC, so `nuxt typecheck` checks it against the
 *   component's actual API, the page shows its source verbatim, and the
 *   browser suite renders it. A usage string could drift from the API
 *   silently; a source file cannot.
 *
 * This is development tooling for this site, not a published API. `check.mts`
 * keeps it honest against the shell registry and the files on disk.
 */

export type ExampleCategory = 'components' | 'charts' | 'maps' | 'patterns'

export interface ExampleMeta {
  id: string
  title: string
  /** Owning workspace package. */
  package: string
  category: ExampleCategory
  summary: string
  /** The registered component name this demo covers, when it covers one. */
  component?: string
  /** Design card basename, without `.card.vue`. */
  card?: string
  interactive?: boolean
}

const SHELL = '@narduk-enterprises/narduk-shell'

function shell(
  component: string,
  title: string,
  summary: string,
  extra: Partial<ExampleMeta> = {},
): ExampleMeta {
  return {
    id: component.replace(/([a-z])([A-Z])/g, '$1-$2').toLowerCase(),
    title,
    package: SHELL,
    category: 'components',
    summary,
    component,
    card: component,
    ...extra,
  }
}

export const EXAMPLES: readonly ExampleMeta[] = [
  shell(
    'NePageHeader',
    'Page header',
    'Eyebrow, title, description and right-aligned actions for a page.',
  ),
  shell(
    'NeSectionHeader',
    'Section header',
    'A heading for a section inside a page, with optional actions.',
  ),
  shell(
    'NeStatusBadge',
    'Status badge',
    'A status word with a semantic tone and icon; never colour alone.',
  ),
  shell(
    'NeConfirmDialog',
    'Confirm dialog',
    'A modal confirmation, usually opened through useConfirm().',
  ),
  shell('NeStatePanel', 'State panel', 'Loading, empty, error and gap states for a data region.'),
  shell('NePager', 'Pager', 'Page controls bound to useCollection() state.'),
  shell('NeFilterBar', 'Filter bar', 'Chips or tabs that pick one view of a list, with counts.'),
  shell(
    'NeSearchInput',
    'Search input',
    'Debounced search beside a collection; bind c.q with debounce 0.',
  ),
  shell('NeForm', 'Form', 'A Nuxt UI form with the estate submit and error layout.'),
  shell('NeFormSection', 'Form section', 'A titled group of fields inside a form.'),
  shell(
    'NeSettingsPage',
    'Settings page',
    'The settings screen layout: page header, form sections and a save bar.',
  ),
  shell('NeKpiTile', 'KPI tile', 'A headline number with a signed, glyph-marked delta.'),
  shell('NeKpiBand', 'KPI band', 'A responsive row of KPI tiles.'),
  shell(
    'NeDataTable',
    'Data table',
    'UTable with grouped units, tabular numerals, missing-last sorting and a phone column switch.',
    { interactive: true },
  ),
  shell('NeSortHeader', 'Sort header', 'A sortable column header for server or client sorting.'),
  shell(
    'NeCsvDownload',
    'CSV download',
    'Downloads exactly the rows in view, raw values, missing as empty.',
  ),
  {
    id: 'formatters',
    title: 'Formatters',
    package: SHELL,
    category: 'components',
    summary: 'The ./format helpers every Ne component prints numbers and times with.',
    card: 'Formatters',
  },
]
