<template>
  <div class="space-y-3">
    <NeMeter label="Core REST" :value="4200" :max="5000" />
    <NeMeter label="Search" :value="null" :max="30" />
    <NeMeter label="Headroom" :value="1280" :max="2000" variant="inline" />
  </div>
</template>
