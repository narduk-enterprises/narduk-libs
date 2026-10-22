<script setup lang="ts">
const rows = [
  { symbol: 'AAPL', price: 227.41, change: 0.0184 },
  { symbol: 'BRK.B', price: 1042.9, change: -0.0042 },
  { symbol: 'XYZ', price: null, change: null },
]
</script>

<template>
  <table class="text-sm">
    <tbody>
      <tr v-for="row in rows" :key="row.symbol">
        <th class="pr-4 text-left font-medium">{{ row.symbol }}</th>
        <td><NePriceCell :value="row.price" kind="money" currency="USD" tint="flash" /></td>
        <td>
          <NePriceCell :value="row.change" kind="percent" input="fraction" signed tint="sign" />
        </td>
      </tr>
    </tbody>
  </table>
</template>
