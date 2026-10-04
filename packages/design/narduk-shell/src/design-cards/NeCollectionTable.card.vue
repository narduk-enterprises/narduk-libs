<script setup lang="ts">
/*
 * NE Base design card for NeCollectionTable (narduk-libs#1400), with fixed
 * rows. The first table carries the toolbar (`toolbar="always"`): search,
 * chips counted within the search, the count, and a sort on Hosts with the
 * one unreported host last. The second groups its rows, marks a selected row,
 * stops at a limit with "Show all", and closes on the bounded-read footer.
 * Missing cells read the app's own word (`missingText="unreported"`), not a
 * dash. Cards are prerendered, so nothing here depends on a click.
 */
import NeCollectionTable from '../runtime/components/NeCollectionTable.vue'

import type {
  NeCollectionColumn,
  NeCollectionFilter,
  NeCollectionGroup,
} from '../runtime/components/ne-collection-table-types'

interface App {
  hosts: number | null
  name: string
  owner: string
  stage: string
}

const apps: App[] = [
  { hosts: 4, name: 'operator-portal', owner: 'Platform', stage: 'live' },
  { hosts: null, name: 'buoys', owner: 'Marine', stage: 'live' },
  { hosts: 2, name: 'stonx', owner: 'Markets', stage: 'beta' },
  { hosts: 1, name: 'tideye', owner: 'Marine', stage: 'beta' },
  { hosts: 3, name: 'narduk-auth', owner: 'Platform', stage: 'live' },
]

const columns: Array<NeCollectionColumn<App>> = [
  { key: 'name', label: 'App' },
  { key: 'owner', label: 'Owner', width: '8rem' },
  { key: 'stage', label: 'Stage', width: '6rem' },
  { key: 'hosts', label: 'Hosts', numeric: true, width: '6rem' },
]

const filters: Array<NeCollectionFilter<App>> = [
  { key: 'live', label: 'Live', test: (app) => app.stage === 'live' },
  { key: 'beta', label: 'Beta', test: (app) => app.stage === 'beta' },
]

interface Run {
  id: string
  job: string
  note: string | null
  waited: number
}

const runColumns: Array<NeCollectionColumn<Run>> = [
  { key: 'job', label: 'Job' },
  { key: 'note', label: 'Note', freeText: true },
  { key: 'waited', label: 'Waited', numeric: true, unit: 's', width: '6rem' },
]

const runGroups: Array<NeCollectionGroup<Run>> = [
  {
    count: 2,
    key: 'running',
    label: 'Running',
    rows: [
      { id: 'r1', job: 'quality', note: 'Lint and typecheck', waited: 4 },
      { id: 'r2', job: 'e2e', note: null, waited: 31 },
    ],
  },
  {
    count: 2,
    key: 'queued',
    label: 'Queued',
    rows: [
      { id: 'r3', job: 'deploy', note: 'Waits on quality', waited: 12 },
      { id: 'r4', job: 'smoke', note: null, waited: 2 },
    ],
  },
]
</script>

<template>
  <section
    class="preview-card"
    data-design-card="ne-collection-table"
    data-name="Collection table"
    data-group="Shell"
  >
    <h2>Collection table</h2>
    <div class="preview-row">
      <NeCollectionTable
        caption="Apps"
        :columns="columns"
        :rows="apps"
        :filters="filters"
        :row-key="(app) => app.name"
        noun="apps"
        sort="hosts:desc"
        toolbar="always"
        missing-text="unreported"
      />
    </div>
    <div class="preview-row">
      <NeCollectionTable
        caption="Runs"
        :columns="runColumns"
        :groups="runGroups"
        :limit="3"
        selected-key="r1"
        missing-text="unreported"
        :toolbar="false"
        :more="{ label: '4 of 9 runs today' }"
      />
    </div>
  </section>
</template>
