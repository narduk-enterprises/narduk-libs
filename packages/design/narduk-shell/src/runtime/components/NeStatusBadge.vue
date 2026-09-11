<script setup lang="ts">
/**
 * Wraps Nuxt UI's `UBadge` with a fixed tone -> semantic-colour mapping, so
 * no app hand-rolls its own tone map again (operator-portal#156: the exact
 * same tone-map bug landed twice in one evening, in two components, because
 * the mapping lived twice). Pair with `defineStatusMap`
 * (`../utils/status-map`) to turn a domain-specific status union into
 * `{ tone, label }` once:
 *
 *   const flood = defineStatusMap<FloodStage>({
 *     normal: ['ok', 'Normal'],
 *     action: ['warn', 'Action'],
 *     major: ['error', 'Major'],
 *   })
 *   <NeStatusBadge v-bind="flood(stage)" />
 *
 * `UBadge` is referenced as a bare global tag, the way every app in the
 * estate already writes it, rather than imported explicitly: this package
 * type-checks standalone (no live Nuxt app of its own, see the module docs
 * in `src/module.ts`), so a static import would drag Nuxt UI's compiled SFC
 * -- and its build-time-only `#build/ui/badge` alias -- into a program that
 * has no Nuxt build to resolve it against. A real consuming app resolves the
 * tag normally; `test/NeStatusBadge.*.test.ts` register a fake under the
 * same global name.
 */
import { computed } from 'vue'

import type { NeStatusTone } from '../utils/status-map'

type NeStatusBadgeVariant = 'solid' | 'outline' | 'soft' | 'subtle'
type NeStatusBadgeSize = 'xs' | 'sm' | 'md' | 'lg' | 'xl'
type NeStatusBadgeColor = 'success' | 'warning' | 'error' | 'info' | 'neutral'

const props = withDefaults(
  defineProps<{
    /** Overrides the tone's default icon. Only `pending` has one by default. */
    icon?: string
    /** Visible text, and the core of the accessible name (see below). */
    label: string
    size?: NeStatusBadgeSize
    /** The status this badge reports. Drives the Nuxt UI semantic colour. */
    tone: NeStatusTone
    /**
     * Opt into ellipsis truncation. Default `false`: the label never
     * truncates or wraps mid-word -- it stays on one line and the badge
     * grows to fit. `operator-portal#156`: `overflow-wrap: anywhere` split
     * the single word "unknown" into "unknow" / "n" across two independent
     * components in one evening once a value cell got narrow enough; a
     * status word must never be allowed to break like that by default.
     */
    truncate?: boolean
    /** Overrides the tone's default variant. Only `pending` has one: `subtle`. */
    variant?: NeStatusBadgeVariant
  }>(),
  { truncate: false },
)

/** The one place the tone vocabulary picks its Nuxt UI semantic colour. */
const TONE_COLOR: Record<NeStatusTone, NeStatusBadgeColor> = {
  ok: 'success',
  warn: 'warning',
  error: 'error',
  info: 'info',
  neutral: 'neutral',
  pending: 'neutral',
}

/** `pending` is the one tone with opinions beyond its colour: a quieter
 *  variant and a small leading icon, both still overridable per instance. */
const PENDING_VARIANT: NeStatusBadgeVariant = 'subtle'
const PENDING_ICON = 'i-lucide-loader-circle'

const color = computed<NeStatusBadgeColor>(() => TONE_COLOR[props.tone])

const variant = computed<NeStatusBadgeVariant | undefined>(
  () => props.variant ?? (props.tone === 'pending' ? PENDING_VARIANT : undefined),
)

const icon = computed<string | undefined>(
  () => props.icon ?? (props.tone === 'pending' ? PENDING_ICON : undefined),
)

/**
 * Colour is never the only signal. The tone is spoken too, folded into one
 * accessible name: `aria-label` wins over visible text content for
 * assistive tech, so this is the single source of truth rather than a
 * second, easy-to-forget visually-hidden span carrying the same words.
 */
const ariaLabel = computed(() => `${props.tone}: ${props.label}`)

const labelClass = computed(() => (props.truncate ? 'truncate' : 'whitespace-nowrap'))
</script>

<template>
  <UBadge :color="color" :variant="variant" :size="size" :icon="icon" :aria-label="ariaLabel">
    <span :class="labelClass" data-slot="label">{{ label }}</span>
  </UBadge>
</template>
