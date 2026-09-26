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
  shell(
    'NeAdminListPage',
    'Admin list page',
    'Header, search, filters, table and pager, all on one useCollection().',
  ),
  shell(
    'NeAdminDetailPage',
    'Admin detail page',
    'One record under a page header, with a delete that asks through useConfirm() first.',
  ),
  shell(
    'NeAdminEditPage',
    'Admin edit page',
    'A sticky-save form with a cancel action, held back until the record has loaded.',
  ),
  shell('NeKpiTile', 'KPI tile', 'A headline number with a signed, glyph-marked delta.'),
  shell('NeKpiBand', 'KPI band', 'A responsive row of KPI tiles.'),
  shell('NeCard', 'Card', 'One entity card: media, title, badge, stat rows and actions.'),
  shell('NeCardList', 'Card list', 'The card reading of the same collection state as the table.'),
  shell(
    'NeDetailView',
    'Detail view',
    'A key-value panel with format, unit and an unavailable message.',
  ),
  shell(
    'NeMeter',
    'Meter',
    'One value against a known ceiling; an unreported value is hatched, never empty.',
  ),
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
  shell(
    'NeProse',
    'Prose',
    'A markdown document in the type scale, h1 demoted, heading ids for a TOC, no v-html.',
  ),
  shell(
    'NeAppShell',
    'App shell',
    'The opt-in sectioned left rail, navbar row and page frame; a slide-over below lg.',
  ),
  shell(
    'NeSkipLink',
    'Skip link',
    'Skip to content that moves keyboard focus to the target, not only the scroll position.',
  ),
  shell('NeHero', 'Hero', 'The top of a landing page: headline, title, description and buttons.'),
  shell('NeFeatureGrid', 'Feature grid', 'Feature tiles in a responsive grid, one list item each.'),
  shell('NeCta', 'Call to action', 'A panel with a title, a description and buttons.'),
  shell(
    'NeMarketingFooter',
    'Marketing footer',
    'The site footer: left, centre and right rows, with columns in #top.',
  ),
  shell(
    'NeDataAttribution',
    'Data attribution',
    'A consistent "Data from <source>, updated <time>" credit with safe source links.',
  ),
  shell(
    'NeLegalPage',
    'Legal page',
    'Title, last-updated date, contents and sections; template wording is placeholder-only.',
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
