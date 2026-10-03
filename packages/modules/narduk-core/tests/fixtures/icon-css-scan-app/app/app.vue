<template>
  <UApp>
    <main class="p-6">
      <nav id="bundle-icons" class="flex gap-4 text-2xl">
        <Icon name="lucide:menu" />
        <Icon name="lucide:sun" />
        <Icon name="lucide:moon" />
        <Icon name="lucide:x" />
        <Icon name="lucide:check" class="text-green-600" />
        <UButton icon="lucide:copy" label="Copy" />
      </nav>
      <p id="late-icon">
        <ClientOnly><Icon name="lucide:search" class="text-2xl" /></ClientOnly>
      </p>
    </main>
  </UApp>
</template>
