<template>
  <NePageHeader
    eyebrow="Infrastructure"
    title="Runners"
    description="Every self-hosted runner class."
    :breadcrumbs="[{ label: 'Home', to: '/' }, { label: 'Runners' }]"
  >
    <template #actions>
      <UButton icon="i-lucide-plus">New runner</UButton>
    </template>
  </NePageHeader>
</template>
