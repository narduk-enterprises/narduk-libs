<script setup lang="ts">
const props = defineProps<{ text: string; label?: string }>()
const copied = ref(false)

async function copy() {
  await navigator.clipboard.writeText(props.text)
  copied.value = true
  setTimeout(() => (copied.value = false), 1500)
}
</script>

<template>
  <UButton
    size="xs"
    color="neutral"
    variant="ghost"
    :icon="copied ? 'i-lucide-check' : 'i-lucide-copy'"
    :aria-label="copied ? 'Copied' : `Copy ${label ?? text}`"
    @click="copy"
  />
</template>
