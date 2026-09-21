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
  /** A consumer-ready snippet. */
  usage: string
}

const SHELL = '@narduk-enterprises/narduk-shell'

function shell(
  component: string,
  title: string,
  summary: string,
  usage: string,
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
    usage,
    ...extra,
  }
}

export const EXAMPLES: readonly ExampleMeta[] = [
  shell(
    'NePageHeader',
    'Page header',
    'Eyebrow, title, description and right-aligned actions for a page.',
    '<NePageHeader eyebrow="Fleet" title="Runners" description="Every self-hosted runner." />',
  ),
  shell(
    'NeSectionHeader',
    'Section header',
    'A heading for a section inside a page, with optional actions.',
    '<NeSectionHeader title="Recent runs" :count="42" />',
  ),
  shell(
    'NeStatusBadge',
    'Status badge',
    'A status word with a semantic tone and icon; never colour alone.',
    '<NeStatusBadge label="Online" tone="ok" />',
  ),
  shell(
    'NeConfirmDialog',
    'Confirm dialog',
    'A modal confirmation, usually opened through useConfirm().',
    "const confirm = useConfirm()\nconst ok = await confirm({ title: 'Delete runner?', tone: 'danger' })",
  ),
  shell(
    'NeStatePanel',
    'State panel',
    'Loading, empty, error and gap states for a data region.',
    '<NeStatePanel :status="status" title="No runs yet" message="Runs appear here once a job starts." />',
  ),
  shell(
    'NePager',
    'Pager',
    'Page controls bound to useCollection() state.',
    '<NePager v-model:state="collection.state" noun="runners" :page-sizes="[25, 50, 100]" />',
  ),
  shell(
    'NeFilterBar',
    'Filter bar',
    'Chips or tabs that pick one view of a list, with counts.',
    "<NeFilterBar v-model=\"view\" label=\"Show\" :items=\"[{ key: 'all', label: 'All' }, { key: 'failed', label: 'Failed' }]\" />",
  ),
  shell(
    'NeForm',
    'Form',
    'A Nuxt UI form with the estate submit and error layout.',
    '<NeForm :schema="schema" :state="state" :on-submit="save">…</NeForm>',
  ),
  shell(
    'NeFormSection',
    'Form section',
    'A titled group of fields inside a form.',
    '<NeFormSection title="Profile" description="Shown to your team.">…</NeFormSection>',
  ),
  shell(
    'NeSettingsPage',
    'Settings page',
    'The settings screen layout: page header, form sections and a save bar.',
    '<NeSettingsPage title="Settings" :state="state" :on-submit="save">…</NeSettingsPage>',
  ),
  shell(
    'NeKpiTile',
    'KPI tile',
    'A headline number with a signed, glyph-marked delta.',
    '<NeKpiTile label="Runners online" :value="128" :delta="6" tone="ok" />',
  ),
  shell(
    'NeKpiBand',
    'KPI band',
    'A responsive row of KPI tiles.',
    '<NeKpiBand :columns="{ base: 1, md: 3 }"><NeKpiTile … /></NeKpiBand>',
  ),
  shell(
    'NeDataTable',
    'Data table',
    'UTable with grouped units, tabular numerals, missing-last sorting and a phone column switch.',
    '<NeDataTable :columns="columns" :rows="rows" :sort="sort" @update:sort="setSort" />',
    { interactive: true },
  ),
  shell(
    'NeSortHeader',
    'Sort header',
    'A sortable column header for server or client sorting.',
    '<NeSortHeader label="Wind" unit="kt" sort-key="wind" :sort="sort" @update:sort="setSort" />',
  ),
  shell(
    'NeCsvDownload',
    'CSV download',
    'Downloads exactly the rows in view, raw values, missing as empty.',
    '<NeCsvDownload :columns="columns" :rows="rows" filename="readings.csv" />',
  ),
  {
    id: 'formatters',
    title: 'Formatters',
    package: SHELL,
    category: 'components',
    summary: 'The ./format helpers every Ne component prints numbers and times with.',
    card: 'Formatters',
    usage: "import { formatNumber } from '@narduk-enterprises/narduk-shell/format'",
  },
]
