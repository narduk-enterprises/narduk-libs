<script setup lang="ts">
defineProps<{ code: string; label?: string }>()
</script>

<template>
  <div class="flex items-start gap-2 rounded-md border border-default bg-muted p-3">
    <pre
      class="min-w-0 flex-1 overflow-x-auto font-mono text-sm whitespace-pre"
    ><code>{{ code }}</code></pre>
    <CopyButton :text="code" :label="label ?? 'snippet'" />
  </div>
</template>
