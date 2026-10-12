<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

import { NardukGeoMap } from '../src/svg'
import { NardukMap } from '../src/gl'
import '../src/styles/map.css'

import { parseCsv } from './csv'
import actionsCsv from './data/actions.csv?raw'
import countiesRaw from './data/counties.tiger.json?raw'
import marcLevels from './data/marc-levels.json'
import townsRaw from './data/towns.geojson?raw'
import aqDeskRaw from './data/aquidneck.desk.json?raw'
import aqPhoneRaw from './data/aquidneck.phone.json?raw'
import marcDeskRaw from './data/marc.desk.json?raw'
import marcPhoneRaw from './data/marc.phone.json?raw'

import type { CutoutBasemap, MapPoint, MarkShape, ShapeCollection } from '../src/types'

// Real public data, copied into lab/data: MARC's county outlines and current SARS-CoV-2
// levels, Aquidneck's town outlines and the coordinates of its coastal-resilience actions.
// The query string is read after mount so the first render matches the server.
const dark = ref(false)
const only = ref<string | null>(null)
const glReady = ref<Record<string, boolean>>({})

onMounted(() => {
  const qs = new URLSearchParams(location.search)
  dark.value = qs.get('dark') === '1'
  only.value = qs.get('only')
})

const scheme = computed(() => (dark.value ? 'dark' : 'light'))
const show = (id: string) => only.value === null || only.value === id

// ---- Aquidneck
const STATUS: Record<string, { shape: MarkShape; color: string }> = {
  'Not started': { shape: 'small', color: '#c3cad0' },
  Planning: { shape: 'ring', color: '#8ea6c4' },
  Funded: { shape: 'dot', color: '#c98f1a' },
  'In progress': { shape: 'dot', color: '#24689f' },
  Complete: { shape: 'core', color: '#1d5c3a' },
}
const NO_STATUS = { shape: 'hollow' as MarkShape, color: '#8b96a0' }

const actions = parseCsv(actionsCsv)
// Rows without coordinates are never drawn and never given invented ones.
const points: MapPoint[] = actions.flatMap(row => {
  const lat = Number.parseFloat(row.lat ?? '')
  const lon = Number.parseFloat(row.lon ?? '')
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return []
  const style = STATUS[row.status ?? ''] ?? NO_STATUS
  return [
    {
      id: row.id as string,
      lon,
      lat,
      color: style.color,
      shape: style.shape,
      href: `#${row.id}`,
      label: `${row.title} (${row.town}, ${row.status || 'no status yet'})`,
    },
  ]
})
const undrawn = actions.filter(r => !r.lat || !r.lon).map(r => r.id)
const aqHighlight = points.find(p => p.shape === 'core')?.id ?? null
const aqShapes = JSON.parse(townsRaw) as ShapeCollection

// Baked cutouts of the same frames (build-time output of the cutout CLI, committed as data).
const aqDesk = JSON.parse(aqDeskRaw) as CutoutBasemap
const aqPhone = JSON.parse(aqPhoneRaw) as CutoutBasemap
const marcDesk = JSON.parse(marcDeskRaw) as CutoutBasemap
const marcPhone = JSON.parse(marcPhoneRaw) as CutoutBasemap

// ---- MARC
const LEVELS = ['Very Low', 'Low', 'Moderate', 'High', 'Very High']
const LEVEL_COLORS = ['#dbe9f4', '#9fc5e3', '#f2c45a', '#e07b39', '#bf3b2c']
// Census TIGERweb outlines follow the river, so they sit true against the baked shoreline.
const tiger = JSON.parse(countiesRaw) as ShapeCollection
const marcShapes: ShapeCollection = {
  ...tiger,
  features: tiger.features.map(f => ({
    ...f,
    properties: {
      fips: f.properties?.GEOID,
      name: String(f.properties?.NAME ?? '').replace(/ County$/, ''),
    },
  })),
}
const countyData = marcLevels.counties as Record<string, { level: string | null; sites: number }>
const marcFills: Record<string, string> = {}
const marcHatch: Record<string, boolean> = {}
const marcText: Record<string, string> = {}
for (const f of marcShapes.features) {
  const fips = String(f.properties?.fips)
  const entry = countyData[fips]
  const index = entry?.level ? LEVELS.indexOf(entry.level) : -1
  if (index >= 0) {
    marcFills[fips] = LEVEL_COLORS[index] as string
    marcText[fips] = entry?.level as string
  } else {
    marcHatch[fips] = true
    marcText[fips] = 'No site'
  }
}
const selected = ref<string | null>('29095')
const labReady = computed(() => {
  const id = only.value
  if (!id) return true
  return id.includes('gl') || id === 'dark-row' ? Boolean(glReady.value[id]) : true
})
const marcLabel = `Wastewater SARS-CoV-2 level by county, ${marcLevels.as_of}`
</script>

<template>
  <main class="lab" :class="{ 'lab--dark': dark }">
    <h1 v-if="only === null">narduk-maps lab</h1>

    <section v-if="show('aquidneck-svg')" id="aquidneck-svg" class="lab__card">
      <h2>Aquidneck, SVG, desktop</h2>
      <div class="lab__wide">
        <NardukGeoMap
          :shapes="aqShapes"
          :padding="32"
          name-key="name"
          id-key="name"
          :points="points"
          :highlight="aqHighlight"
          :width="640"
          :scheme="scheme"
          table
          aria-label="Aquidneck Island coastal resilience actions"
        />
      </div>
      <p class="lab__note">
        {{ points.length }} of {{ actions.length }} actions have coordinates;
        {{ undrawn.join(', ') }}
        have none and are not drawn.
      </p>
    </section>

    <section v-if="show('aquidneck-svg-375')" id="aquidneck-svg-375" class="lab__card">
      <h2>Aquidneck, SVG, 375px</h2>
      <div class="lab__phone">
        <NardukGeoMap
          :shapes="aqShapes"
          id-key="name"
          :points="points"
          :highlight="aqHighlight"
          :width="343"
          :padding="16"
          :scheme="scheme"
          aria-label="Aquidneck Island coastal resilience actions"
        />
      </div>
    </section>

    <section v-if="show('aquidneck-gl')" id="aquidneck-gl" class="lab__card">
      <h2>Aquidneck, GL, with the SVG poster</h2>
      <div class="lab__wide">
        <NardukMap
          :shapes="aqShapes"
          :padding="32"
          id-key="name"
          :points="points"
          :highlight="aqHighlight"
          :width="640"
          :height="460"
          :scheme="scheme"
          load="eager"
          aria-label="Aquidneck Island coastal resilience actions"
          @ready="glReady['aquidneck-gl'] = true"
        />
      </div>
    </section>

    <section v-if="show('marc-normal')" id="marc-normal" class="lab__card">
      <h2>MARC choropleth, SVG</h2>
      <div class="lab__narrow">
        <NardukGeoMap
          :shapes="marcShapes"
          :padding="32"
          id-key="fips"
          :fills="marcFills"
          :hatch="marcHatch"
          :water="false"
          :level-text="marcText"
          :scheme="scheme"
          :aria-label="marcLabel"
        />
      </div>
    </section>

    <section v-if="show('marc-plain')" id="marc-plain" class="lab__card">
      <h2>MARC choropleth, plain (print)</h2>
      <div class="lab__narrow">
        <NardukGeoMap
          :shapes="marcShapes"
          :padding="32"
          id-key="fips"
          :fills="marcFills"
          :hatch="marcHatch"
          :water="false"
          :level-text="marcText"
          plain
          :scheme="scheme"
          :aria-label="marcLabel"
        />
      </div>
    </section>

    <section v-if="show('marc-interactive')" id="marc-interactive" class="lab__card">
      <h2>MARC choropleth, interactive (selected {{ selected }})</h2>
      <div class="lab__narrow">
        <NardukGeoMap
          :shapes="marcShapes"
          :padding="32"
          id-key="fips"
          :fills="marcFills"
          :hatch="marcHatch"
          :water="false"
          :level-text="marcText"
          interactive
          :selected="selected"
          :scheme="scheme"
          :aria-label="marcLabel"
          @select="selected = $event"
        />
      </div>
    </section>

    <section v-if="show('aquidneck-cutout')" id="aquidneck-cutout" class="lab__card">
      <h2>Aquidneck, SVG on a baked cutout, desktop</h2>
      <div class="lab__cutout">
        <NardukGeoMap
          :shapes="aqShapes"
          id-key="name"
          :basemap="aqDesk"
          labels="none"
          :points="points"
          :highlight="aqHighlight"
          :scheme="scheme"
          aria-label="Aquidneck Island coastal resilience actions"
        />
      </div>
    </section>

    <section v-if="show('aquidneck-cutout-375')" id="aquidneck-cutout-375" class="lab__card">
      <h2>Aquidneck, SVG on a baked cutout, 375px</h2>
      <div class="lab__phone">
        <NardukGeoMap
          :shapes="aqShapes"
          id-key="name"
          :basemap="aqPhone"
          labels="none"
          :points="points"
          :highlight="aqHighlight"
          :scheme="scheme"
          aria-label="Aquidneck Island coastal resilience actions"
        />
      </div>
    </section>

    <section v-if="show('marc-cutout')" id="marc-cutout" class="lab__card">
      <h2>MARC choropleth on a baked cutout, desktop</h2>
      <div class="lab__cutout">
        <NardukGeoMap
          :shapes="marcShapes"
          id-key="fips"
          :basemap="marcDesk"
          :fills="marcFills"
          :hatch="marcHatch"
          :level-text="marcText"
          :scheme="scheme"
          :aria-label="marcLabel"
        />
      </div>
    </section>

    <section v-if="show('marc-cutout-375')" id="marc-cutout-375" class="lab__card">
      <h2>MARC choropleth on a baked cutout, 375px</h2>
      <div class="lab__phone">
        <NardukGeoMap
          :shapes="marcShapes"
          id-key="fips"
          :basemap="marcPhone"
          :fills="marcFills"
          :hatch="marcHatch"
          :level-text="marcText"
          :scheme="scheme"
          :aria-label="marcLabel"
        />
      </div>
    </section>

    <section
      v-if="show('dark-row')"
      id="dark-row"
      class="lab__card lab__card--dark narduk-map--dark"
    >
      <h2>Dark row</h2>
      <div class="lab__row">
        <NardukGeoMap
          :shapes="aqShapes"
          id-key="name"
          :points="points"
          :highlight="aqHighlight"
          :width="420"
          scheme="dark"
          aria-label="Aquidneck, dark"
        />
        <NardukGeoMap
          :shapes="marcShapes"
          id-key="fips"
          :fills="marcFills"
          :hatch="marcHatch"
          :water="false"
          :level-text="marcText"
          :width="420"
          scheme="dark"
          aria-label="MARC, dark"
        />
        <NardukMap
          :shapes="aqShapes"
          id-key="name"
          :points="points"
          :highlight="aqHighlight"
          :width="420"
          :height="420"
          scheme="dark"
          load="eager"
          aria-label="Aquidneck GL, dark"
          @ready="glReady['dark-row'] = true"
        />
      </div>
    </section>
    <span v-if="only" id="lab-state" :data-ready="labReady" />
  </main>
</template>

<style>
:root {
  color-scheme: light;
}
body {
  margin: 0;
  font-family: ui-sans-serif, system-ui, sans-serif;
  background: #ffffff;
  color: #1f2a33;
}
.lab {
  padding: 16px;
  display: grid;
  gap: 16px;
}
.lab--dark {
  background: #0d1419;
  color: #e3eaef;
  min-height: 100vh;
}
.lab h1,
.lab h2 {
  margin: 0 0 8px;
  font-size: 14px;
}
.lab__card {
  padding: 12px;
  border: 1px solid #d8dee3;
  border-radius: 8px;
  background: #fff;
}
.lab--dark .lab__card,
.lab__card--dark {
  background: #141c23;
  border-color: #2a3640;
  color: #e3eaef;
}
.lab__wide {
  max-width: 640px;
}
.lab__narrow {
  max-width: 520px;
}
.lab__cutout {
  max-width: 960px;
}
.lab__phone {
  width: min(343px, 100%);
}
.lab__row {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
  gap: 12px;
}
.lab__note {
  margin: 8px 0 0;
  font-size: 12px;
  opacity: 0.7;
}
</style>
