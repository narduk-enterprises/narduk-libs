<script setup lang="ts">
const props = defineProps<{ text: string; label?: string }>()

// "Copied" only after the clipboard accepted the text. A refusal (no
// permission, an insecure context, no clipboard at all) says so instead.
const state = ref<'idle' | 'copied' | 'failed'>('idle')
let timer: ReturnType<typeof setTimeout> | undefined

async function copy() {
  clearTimeout(timer)
  try {
    await navigator.clipboard.writeText(props.text)
    state.value = 'copied'
  } catch {
    state.value = 'failed'
  }
  timer = setTimeout(() => (state.value = 'idle'), 2000)
}

const name = computed(() => props.label ?? props.text)
</script>

<template>
  <span class="inline-flex items-center">
    <UButton
      size="xs"
      color="neutral"
      variant="ghost"
      :icon="
        state === 'copied'
          ? 'i-lucide-check'
          : state === 'failed'
            ? 'i-lucide-circle-alert'
            : 'i-lucide-copy'
      "
      :aria-label="`Copy ${name}`"
      data-testid="copy-button"
      :data-state="state"
      @click="copy"
    />
    <span class="sr-only" aria-live="polite">{{
      state === 'copied' ? `Copied ${name}` : state === 'failed' ? `Could not copy ${name}` : ''
    }}</span>
    <span v-if="state === 'failed'" class="text-xs text-error">Copy failed</span>
  </span>
</template>
