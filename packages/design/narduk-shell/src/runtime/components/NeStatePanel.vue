<script setup lang="ts">
/**
 * NeStatePanel — one panel for empty · loading · error · blocked · absent.
 *
 * Backlog item 7 (narduk-libs#254). It wraps Nuxt UI rather than
 * reimplementing it: `UEmpty` for `empty`/`absent`, `USkeleton` for `loading`,
 * `UAlert` for `error`/`blocked`.
 *
 * The reason it has five readings rather than the usual "empty or not" is the
 * bug class it forecloses: a surface that cannot tell *unknown* from *zero*
 * renders a confident 0, a green "queue clear", or a red UNKNOWN on a
 * thirty-second-old feed, and the operator learns to ignore the cell
 * (operator-portal#183, #162, #100, #21; #282 asks for exactly this component).
 * So `absent` — no producer publishes this fact — is a distinct reading with
 * its own wording and its own shape, and it never looks like `empty` (the read
 * answered and found nothing) or like `loading` (the read has not answered).
 *
 * Accessibility is by construction, not by caller discipline:
 *
 * - `loading` is `role="status"`, `aria-live="polite"`, `aria-busy="true"`.
 * - `error` is `role="alert"`.
 * - `empty` / `absent` / `blocked` are `role="status"`.
 * - every state renders its name as text (the eyebrow), so the reading never
 *   depends on colour, and the three non-loading shapes differ by border style
 *   as well as by hue.
 *
 * Styling reads Nuxt UI's semantic classes (`border-default`, `text-muted`,
 * `text-highlighted`), which resolve through the `--ui-*` variables that
 * backlog item 2's `theme.css` maps the NE tokens onto. Nothing here hardcodes
 * a colour, radius or font.
 */
import { computed } from 'vue'

import type { NeAsyncDataStatus, NeStateGap, NeStatePanelProps, NeStateValue } from '../types'

interface NormalisedGap {
  id: string
  key: string
  need: string
}

/**
 * `''` is the internal "no reading" sentinel: the component renders its default
 * slot instead of a panel. The public prop types stay optional, not empty
 * strings — this is only how the resolved reading is carried around, so that
 * a `v-if` and a `Record` lookup both narrow on the same falsy value.
 */
type ResolvedState = NeStateValue | ''

const props = withDefaults(defineProps<NeStatePanelProps>(), {
  as: 'div',
  eyebrow: '',
  gaps: () => [],
  icon: '',
  message: '',
  state: undefined,
  status: undefined,
  title: '',
  unblocksHref: '',
  unblocksOn: '',
  unblocksRef: '',
})

/**
 * `useAsyncData()`'s status, mapped onto a reading. `success` is deliberately
 * not a state: a successful read with rows is the default slot's job, and a
 * successful read with none is `empty`, which only the caller can know.
 */
const STATUS_STATE: Readonly<Record<NeAsyncDataStatus, ResolvedState>> = {
  error: 'error',
  idle: 'loading',
  pending: 'loading',
  success: '',
}

/** Text, always rendered, so no reading depends on colour. */
const STATE_EYEBROW: Readonly<Record<NeStateValue, string>> = {
  absent: 'Not reported',
  blocked: 'Blocked',
  empty: 'Empty',
  error: 'Error',
  loading: 'Loading',
}

const STATE_ICON: Readonly<Record<NeStateValue, string>> = {
  absent: 'i-lucide-circle-dashed',
  blocked: 'i-lucide-unplug',
  empty: 'i-lucide-inbox',
  error: 'i-lucide-circle-alert',
  loading: '',
}

/**
 * Shape, not hue. A dashed box is a placeholder for a set; a dotted left rule
 * is a fact nobody publishes, inline beside facts that are; a solid box is a
 * read still in flight. `error` and `blocked` carry `UAlert`'s own frame.
 */
const STATE_SHELL: Readonly<Record<NeStateValue, string>> = {
  absent: 'border-l-2 border-dotted border-default py-2 pl-4 text-left',
  blocked: '',
  empty: 'rounded-md border border-dashed border-default p-6 text-center',
  error: '',
  loading: 'rounded-md border border-default p-6',
}

const ALERT_TITLE_FALLBACK: Readonly<Record<'blocked' | 'error', string>> = {
  blocked: 'This view depends on a read that did not answer',
  error: 'This view could not be loaded',
}

const state = computed<ResolvedState>(() => {
  // An explicit `state` wins over a bound `status` whenever it is set, which is
  // what lets a caller compose the two:
  //   :status="status" :state="status === 'success' && !rows.length ? 'empty' : undefined"
  if (props.state) return props.state
  if (props.status) return STATUS_STATE[props.status]
  return ''
})

const isLoading = computed(() => state.value === 'loading')
const isEmptyLike = computed(() => state.value === 'empty' || state.value === 'absent')
const isAlertLike = computed(() => state.value === 'error' || state.value === 'blocked')

const eyebrow = computed(() => {
  if (props.eyebrow) return props.eyebrow
  return state.value ? STATE_EYEBROW[state.value] : ''
})

const icon = computed(() => {
  if (props.icon) return props.icon
  return state.value ? STATE_ICON[state.value] : ''
})

const shellClass = computed(() => (state.value ? STATE_SHELL[state.value] : ''))

/** `role="alert"` is assertive by definition, which is right only for a failure. */
const role = computed(() => (state.value === 'error' ? 'alert' : 'status'))

const alertColor = computed(() => (state.value === 'error' ? 'error' : 'warning'))

const alertTitle = computed(() => {
  if (props.title) return props.title
  return state.value === 'error' ? ALERT_TITLE_FALLBACK.error : ALERT_TITLE_FALLBACK.blocked
})

const gaps = computed<NormalisedGap[]>(() =>
  props.gaps.map((gap: string | NeStateGap, index: number) => {
    if (typeof gap === 'string') return { id: '', key: `${index}:${gap}`, need: gap }
    return { id: gap.id, key: `${index}:${gap.id}`, need: gap.need }
  }),
)

const hasUnblocks = computed(() => Boolean(props.unblocksOn || props.unblocksRef))
</script>

<template>
  <!--
    UEmpty, USkeleton and UAlert are registered globally by @nuxt/ui in the
    consuming app (a peer dependency pinned to 4.6.0). They are deliberately
    not imported: their sources resolve #build/ui/* and #imports, virtual
    modules that exist only inside a Nuxt build, so an import here would be
    unresolvable in this package and in every test. The root eslint config
    allows the `U*` prefix for this directory for exactly that reason.
  -->
  <slot v-if="!state" />
  <component
    :is="as"
    v-else
    class="ne-state-panel"
    :class="[`ne-state-panel--${state}`, shellClass]"
    :data-ne-state="state"
    :data-testid="`ne-state-panel-${state}`"
    :role="role"
    :aria-live="isLoading ? 'polite' : undefined"
    :aria-busy="isLoading ? 'true' : undefined"
  >
    <p class="ne-state-panel__eyebrow text-xs font-medium uppercase tracking-wide text-muted">
      {{ eyebrow }}
    </p>

    <template v-if="isLoading">
      <p v-if="title" class="ne-state-panel__title mt-2 font-medium text-highlighted">
        {{ title }}
      </p>
      <p v-if="message" class="ne-state-panel__message mt-1 text-sm text-muted">{{ message }}</p>
      <div class="ne-state-panel__skeletons mt-3 space-y-2" aria-hidden="true">
        <USkeleton class="h-4 w-2/5" />
        <USkeleton class="h-4 w-4/5" />
        <USkeleton class="h-4 w-3/5" />
      </div>
    </template>

    <UEmpty
      v-else-if="isEmptyLike"
      class="ne-state-panel__body"
      :icon="icon"
      :title="title"
      :description="message"
    />

    <UAlert
      v-else-if="isAlertLike"
      class="ne-state-panel__body mt-2"
      :color="alertColor"
      variant="subtle"
      :icon="icon"
      :title="alertTitle"
      :description="message"
    />

    <ul v-if="gaps.length" class="ne-state-panel__gaps mt-3 space-y-1 text-sm text-muted">
      <li v-for="gap in gaps" :key="gap.key">
        <code v-if="gap.id" class="ne-state-panel__gap-id">{{ gap.id }}</code>
        <span v-if="gap.id"> — </span>{{ gap.need }}
      </li>
    </ul>

    <p
      v-if="hasUnblocks"
      class="ne-state-panel__unblocks mt-3 flex flex-wrap items-baseline gap-1 text-sm text-muted"
    >
      <span class="ne-state-panel__unblocks-label font-medium">Unblocks on</span>
      <template v-if="unblocksRef">
        <span class="ne-state-panel__unblocks-condition">{{ unblocksOn }}</span>
        <span aria-hidden="true">·</span>
        <a
          v-if="unblocksHref"
          class="ne-state-panel__unblocks-ref underline"
          :href="unblocksHref"
          rel="noopener noreferrer"
          target="_blank"
          >{{ unblocksRef }}</a
        >
        <span v-else class="ne-state-panel__unblocks-ref">{{ unblocksRef }}</span>
      </template>
      <a
        v-else-if="unblocksHref"
        class="ne-state-panel__unblocks-condition underline"
        :href="unblocksHref"
        rel="noopener noreferrer"
        target="_blank"
        >{{ unblocksOn }}</a
      >
      <span v-else class="ne-state-panel__unblocks-condition">{{ unblocksOn }}</span>
    </p>

    <div v-if="$slots.action" class="ne-state-panel__action mt-4">
      <slot name="action" />
    </div>
  </component>
</template>
