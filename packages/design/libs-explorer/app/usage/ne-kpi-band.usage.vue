<template>
  <NeKpiBand :columns="{ base: 1, sm: 2, lg: 4 }">
    <NeKpiTile label="Runners online" :value="128" :delta="6" tone="ok" />
    <NeKpiTile label="Open findings" :value="42" :delta="-3" tone="error" />
    <NeKpiTile label="Queue depth" :value="7" />
    <NeKpiTile label="Median wait" value="42s" detail="last hour" />
  </NeKpiBand>
</template>
