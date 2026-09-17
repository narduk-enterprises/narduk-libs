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
 * Colour is never the only signal. The root is a status landmark
 * (`role="status"`) and the tone is spoken too, folded into one accessible
 * name: `aria-label` wins over visible text content for assistive tech, so
 * this is the single source of truth rather than a second, easy-to-forget
 * visually-hidden span carrying the same words.
 */
const ariaLabel = computed(() => `${props.tone}: ${props.label}`)

const labelClass = computed(() => (props.truncate ? 'truncate' : 'whitespace-nowrap'))

/**
 * Ink for the TINTED variants, because Nuxt UI's own is not readable.
 *
 * `soft`, `subtle` and `outline` all paint `--ui-<color>` text on a 10% tint
 * of that same colour, and `--ui-<color>` is shade 500. Measured with axe on
 * a live app (buoys, 2026-09-17), on white: success 2.04:1, warning 1.79:1,
 * error 3.30:1, info 3.34:1 -- against the 4.5:1 a badge label needs, since
 * badge text is small. On an elevated surface each is worse again. Every
 * status this component exists to report was failing WCAG 1.4.3 in every app
 * that used a tinted variant, which is the whole estate.
 *
 * Shade 800 is the first that clears 4.5:1 on BOTH grounds (worst case 5.71:1,
 * warning on an elevated surface); shade 700 passes on white and lands at
 * 4.02:1 on elevated, which is the near-miss that reads as fixed and is not.
 * The shade is read through `--ui-color-<color>-800` rather than a literal
 * `text-green-800`, so an app that aliases `success` to a different ramp gets
 * its own ramp's shade 800 rather than this component's guess.
 *
 * DARK MODE IS DELIBERATELY LEFT AS IT WAS. `dark:` restores `--ui-<color>`
 * exactly, so this changes nothing there. A dark tint sits on a dark ground
 * and wants a LIGHTER ink, not a darker one -- the opposite correction -- and
 * nothing has measured it yet. Guessing a second colour here would be
 * shipping an unverified change beside a verified one.
 *
 * `solid` is untouched for a different reason: it paints white on the full
 * colour, so a dark ink would be unreadable rather than merely low-contrast.
 * That variant has its own contrast question (white on `success` shade 500 is
 * about 1.9:1) which is a fill-shade decision, not a text one, and no audited
 * surface uses it. It is named here so the omission is visibly a scope line
 * rather than an oversight.
 */
const TINTED_TEXT_CLASS: Partial<Record<NeStatusBadgeColor, string>> = {
  error: 'text-[var(--ui-color-error-800)] dark:text-[var(--ui-error)]',
  info: 'text-[var(--ui-color-info-800)] dark:text-[var(--ui-info)]',
  success: 'text-[var(--ui-color-success-800)] dark:text-[var(--ui-success)]',
  warning: 'text-[var(--ui-color-warning-800)] dark:text-[var(--ui-warning)]',
}

/**
 * `neutral` is absent above on purpose: Nuxt UI already gives its tinted
 * variants a near-body ink rather than a 500 shade, and axe found no neutral
 * badge failing.
 */
const TINTED_VARIANTS = new Set<NeStatusBadgeVariant>(['soft', 'subtle', 'outline'])

/**
 * Applied to the badge ROOT rather than to the label span, so the leading icon
 * is recoloured with the words. An icon left at shade 500 on its own 10% tint
 * is around 1.8:1, under the 3:1 floor non-text content has to clear, and axe
 * has no rule that would have told us.
 */
const ui = computed<{ base: string } | undefined>(() => {
  const tinted = variant.value !== undefined && TINTED_VARIANTS.has(variant.value)
  const base = tinted ? TINTED_TEXT_CLASS[color.value] : undefined
  return base ? { base } : undefined
})
</script>

<template>
  <UBadge
    role="status"
    :color="color"
    :variant="variant"
    :size="size"
    :icon="icon"
    :ui="ui"
    :aria-label="ariaLabel"
  >
    <span :class="labelClass" data-slot="label">{{ label }}</span>
  </UBadge>
</template>
