<script setup lang="ts">
import { safeHref } from '../href'
import type { MapPoint } from '../types'

defineProps<{
  caption: string
  rows: Array<{ id: string; name: string; text?: string }>
  points: MapPoint[]
}>()
</script>

<template>
  <div class="narduk-map-sr-only">
    <table>
      <caption>
        {{
          caption
        }}
      </caption>
      <thead>
        <tr>
          <th scope="col">Name</th>
          <th scope="col">Status</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in rows" :key="`s-${row.id}`">
          <th scope="row">{{ row.name }}</th>
          <td>{{ row.text ?? '' }}</td>
        </tr>
        <tr v-for="point in points" :key="`p-${point.id}`">
          <th scope="row">{{ point.label }}</th>
          <td>
            <a v-if="safeHref(point.href)" :href="safeHref(point.href)">Open</a>
          </td>
        </tr>
      </tbody>
    </table>
  </div>
</template>
