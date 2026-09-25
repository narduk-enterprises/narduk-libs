<template>
  <NeMarketingFooter>
    <!-- Link columns go in #top through Nuxt UI's own UFooterColumns. -->
    <template #top>
      <UFooterColumns
        :columns="[
          { label: 'Catalog', children: [{ label: 'Breakers', to: '/products' }] },
          { label: 'Company', children: [{ label: 'About', to: '/about' }] },
        ]"
      />
    </template>
    <template #left>
      <p>© 2026 Circuit Breaker</p>
    </template>
    <template #right>
      <UButton label="Contact" to="/contact" variant="ghost" color="neutral" />
    </template>
  </NeMarketingFooter>
</template>
