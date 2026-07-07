<script setup lang="ts">
/**
 * AppCopyButton — Clipboard copy with visual feedback.
 *
 * Shows a copy icon that transitions to a check icon for 2 seconds after copying.
 * Works with any text content: URLs, API keys, code snippets, etc.
 *
 * Usage:
 *   <AppCopyButton :text="apiKey" />
 *   <AppCopyButton :text="shareUrl" label="Copy link" />
 */

const props = withDefaults(
  defineProps<{
    /** Button color when idle. */
    color?: 'error' | 'info' | 'primary' | 'secondary' | 'success' | 'warning' | 'neutral'
    /** Duration (ms) to show the check icon after copying. */
    feedbackDuration?: number
    /** Optional visible label. */
    label?: string
    /** Button size. */
    size?: 'xs' | 'sm' | 'md' | 'lg'
    /** The text content to copy to clipboard. */
    text?: string
    /** Button variant. */
    variant?: 'ghost' | 'soft' | 'outline' | 'solid'
  }>(),
  {
    text: '',
    label: '',
    size: 'xs',
    variant: 'ghost',
    color: 'neutral',
    feedbackDuration: 2000,
  },
)

const copied = ref(false)

async function copy() {
  if (!props.text) return

  try {
    await navigator.clipboard.writeText(props.text)
    copied.value = true
    setTimeout(() => {
      copied.value = false
    }, props.feedbackDuration)
  } catch (err) {
    console.error('Failed to copy:', err)
  }
}
</script>

<template>
  <UButton
    :icon="copied ? 'i-lucide-check' : 'i-lucide-copy'"
    :color="copied ? 'success' : color"
    :variant="variant"
    :size="size"
    :label="label"
    :title="copied ? 'Copied!' : 'Copy'"
    @click.prevent.stop="copy"
  />
</template>
