<template>
  <!-- One li per feature; a feature with `to` becomes a whole-tile link. -->
  <NeFeatureGrid
    :features="[
      { title: 'Tested', description: 'Every breaker is load-tested.', icon: 'i-lucide-zap' },
      { title: 'Same day', description: 'Orders before 3pm ship today.', icon: 'i-lucide-truck' },
      { title: 'Support', description: 'Engineers on the phone.', to: '#contact' },
    ]"
  />
</template>
