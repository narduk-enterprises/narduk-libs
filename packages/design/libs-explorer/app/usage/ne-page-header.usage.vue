<template>
  <NePageHeader
    eyebrow="Infrastructure"
    title="Runners"
    description="Every self-hosted runner class."
    :breadcrumbs="[{ label: 'Home', to: '/' }, { label: 'Runners' }]"
  >
    <template #lead>
      <UButton to="/" icon="i-lucide-arrow-left" variant="link" color="neutral">Back</UButton>
    </template>
    <template #meta>
      <span class="font-mono text-xs">read 10:42 CT</span>
    </template>
    <template #actions>
      <UButton icon="i-lucide-plus">New runner</UButton>
    </template>
  </NePageHeader>
</template>
