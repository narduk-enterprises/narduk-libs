<script setup lang="ts">
const stations = [
  { name: 'Port Aransas', wind: 14 },
  { name: 'Sabine Pass', wind: 21 },
  { name: 'Galveston', wind: 8 },
]

const sort = ref<string | null>(null)
function setSort(next: string) {
  sort.value = next
}

// The header only reports the wire form ('wind:desc'); the owner of the rows sorts.
const rows = computed(() => {
  const [key, direction] = (sort.value ?? '').split(':')
  if (key !== 'wind' && key !== 'name') return stations
  const sign = direction === 'desc' ? -1 : 1
  return [...stations].sort((a, b) =>
    key === 'wind' ? (a.wind - b.wind) * sign : a.name.localeCompare(b.name) * sign,
  )
})
</script>

<template>
  <table class="text-sm">
    <thead>
      <tr>
        <th class="text-start">
          <NeSortHeader label="Station" sort-key="name" :sort="sort" @update:sort="setSort" />
        </th>
        <th class="text-end">
          <NeSortHeader
            label="Wind"
            unit="kt"
            sort-key="wind"
            first-direction="desc"
            align="end"
            :sort="sort"
            @update:sort="setSort"
          />
        </th>
      </tr>
    </thead>
    <tbody>
      <tr v-for="row in rows" :key="row.name">
        <td class="pe-6">{{ row.name }}</td>
        <td class="text-end font-mono tabular-nums">{{ row.wind }}</td>
      </tr>
    </tbody>
  </table>
</template>
