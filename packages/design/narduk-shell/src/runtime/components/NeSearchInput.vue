<script setup lang="ts">
/**
 * NeSearchInput — the search field beside a collection (narduk-libs#261),
 * the other half of item 14. `NeFilterBar` is the chip / facet / tab row;
 * this is the text control that sits next to it, never inside it. A search
 * is not a filter chip.
 *
 * ## Debounce is this field's job when it is standalone
 *
 * `v-model` is the applied term, not the keystroke. The box shows what you
 * are typing; the model updates after `debounce` ms (250, the same window
 * `useCollection` uses). A page that is not on `useCollection` still gets
 * one request per settled query rather than one per keystroke.
 *
 * Bind `v-model="c.q"` with `:debounce="0"`. `c.q` is the keystroke value —
 * the collection applies it after its own 250 ms — so a second debounce here
 * would make "GTM1500" wait half a second twice.
 *
 * ## Reset is immediate
 *
 * The trailing clear does not wait out the debounce. An applied search that
 * is being cancelled is cancelled now, or the reader watches the list keep
 * matching a term they just erased. That is the item's "reset": one control,
 * one empty string, no confirmation.
 *
 * ## Length is the contract's length
 *
 * The list-query contract rejects a `q` longer than
 * `LIST_QUERY_DEFAULT_MAX_QUERY_LENGTH` (200). The field uses that as its
 * `maxlength` so a value that cannot travel is never typed. Override
 * `maxLength` only when the route's own ceiling differs.
 *
 * ## What this does not own
 *
 * URL sync, page reset, single-flight. Those are `useCollection`. This
 * component emits a string.
 */
import { LIST_QUERY_DEFAULT_MAX_QUERY_LENGTH } from '@narduk-enterprises/narduk-platform/list-query'
import UButton from '@nuxt/ui/components/Button.vue'
import UInput from '@nuxt/ui/components/Input.vue'
import { onScopeDispose, ref, watch } from 'vue'

import { NE_SEARCH_DEBOUNCE_MS } from './ne-search-input-types'

import type { NeSearchInputProps } from './ne-search-input-types'

const props = withDefaults(defineProps<NeSearchInputProps>(), {
  debounce: NE_SEARCH_DEBOUNCE_MS,
  disabled: false,
  maxLength: LIST_QUERY_DEFAULT_MAX_QUERY_LENGTH,
  modelValue: '',
  pending: false,
  showSummary: false,
  size: 'sm',
})

const emit = defineEmits<{ 'update:modelValue': [value: string] }>()

const draft = ref('')
let lastEmitted = ''
let timer: ReturnType<typeof setTimeout> | undefined

function commit(value: string): void {
  if (value === lastEmitted) return
  lastEmitted = value
  emit('update:modelValue', value)
}

function cancelTimer(): void {
  if (timer === undefined) return
  clearTimeout(timer)
  timer = undefined
}

function schedule(value: string): void {
  cancelTimer()
  if (props.debounce <= 0) {
    commit(value)
    return
  }
  timer = setTimeout(() => {
    timer = undefined
    commit(value)
  }, props.debounce)
}

function onInput(value: unknown): void {
  const next = String(value ?? '').slice(0, props.maxLength)
  draft.value = next
  schedule(next)
}

/**
 * Empty the box and the model in the same tick. A reset that waited out the
 * debounce would keep the previous term live for 250 ms after the reader
 * asked it to stop.
 */
function clear(): void {
  cancelTimer()
  draft.value = ''
  commit('')
}

watch(
  () => props.modelValue,
  (next) => {
    lastEmitted = next
    if (next === draft.value) return
    cancelTimer()
    draft.value = next
  },
  { immediate: true },
)

onScopeDispose(cancelTimer)
</script>

<template>
  <div data-ne-search-input class="flex flex-col gap-1">
    <UInput
      :model-value="draft"
      type="search"
      :name="name"
      :placeholder="placeholder"
      :disabled="disabled"
      :loading="pending"
      :maxlength="maxLength"
      :size="size"
      color="neutral"
      variant="outline"
      icon="i-lucide-search"
      autocomplete="off"
      :aria-label="label"
      :aria-busy="pending ? 'true' : undefined"
      data-ne-search-field
      :ui="draft.length ? { trailing: 'pe-1' } : undefined"
      @update:model-value="onInput"
    >
      <template v-if="draft.length && !disabled" #trailing>
        <UButton
          type="button"
          color="neutral"
          variant="link"
          size="sm"
          icon="i-lucide-circle-x"
          aria-label="Clear search"
          data-ne-search-clear
          @click="clear"
        />
      </template>
    </UInput>
    <p
      v-if="showSummary && modelValue"
      data-ne-search-summary
      aria-live="polite"
      class="text-xs text-muted"
    >
      Searching for “{{ modelValue }}”
    </p>
  </div>
</template>
