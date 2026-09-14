<script setup lang="ts">
import { warnAppEmptyStateDeprecated } from './appEmptyStateDeprecation'

/**
 * AppEmptyState — Universal "no data" placeholder.
 *
 * Shows a centered icon, title, description, and an optional action slot.
 *
 * @deprecated Use `NeStatePanel` from `@narduk-enterprises/narduk-shell`
 * instead. Deprecated in this release, **removed in the next narduk-core
 * major** (D4, Logan 2026-09-11: "Deprecate, remove next major";
 * narduk-libs#254, backlog item 7 of narduk-libs#247).
 *
 * This component can only say "nothing here". It cannot tell *unknown* from
 * *zero*, which is the distinction the surfaces using it actually need — the
 * bug class behind operator-portal#183, #162, #100 and #21. `NeStatePanel`
 * carries five readings (`empty`, `loading`, `error`, `blocked`, `absent`),
 * gives each one the right ARIA role by construction, and never signals the
 * reading with colour alone.
 *
 * Migration — the props map one for one:
 *
 * | `AppEmptyState`         | `NeStatePanel`                                |
 * | ----------------------- | --------------------------------------------- |
 * | (implicit empty)        | `state="empty"`                               |
 * | `title`                 | `title`                                       |
 * | `description`           | `message`                                     |
 * | `icon`                  | `icon`                                        |
 * | default slot (a button) | `#action` slot                                |
 * | `compact`               | no equivalent; pass `class` or `ui` if needed |
 *
 *   <NeStatePanel
 *     state="empty"
 *     icon="i-lucide-inbox"
 *     title="No invoices yet"
 *     message="Create your first invoice to get started."
 *   >
 *     <template #action>
 *       <UButton to="/invoices/new" icon="i-lucide-plus">Create invoice</UButton>
 *     </template>
 *   </NeStatePanel>
 *
 * Markup, props and the rendered empty state are unchanged so no app breaks on
 * the narduk-core patch release that carries this. A one-time, dev-only
 * `console.warn` points at `NeStatePanel`; production stays silent.
 */
withDefaults(
  defineProps<{
    /** Whether to apply a compact vertical padding. */
    compact?: boolean
    /** Secondary text. */
    description?: string
    /** Lucide icon name. */
    icon?: string
    /** Primary text. */
    title: string
  }>(),
  {
    icon: '',
    description: '',
    compact: false,
  },
)

warnAppEmptyStateDeprecated()
</script>

<template>
  <div :class="compact ? 'py-6' : 'py-12'" class="text-center">
    <div
      v-if="icon"
      class="mx-auto mb-4 flex size-14 items-center justify-center rounded-2xl bg-primary/10 text-primary"
      aria-hidden="true"
    >
      <!-- eslint-disable-next-line vuejs-accessibility/alt-text -- region is aria-hidden; title provides context -->
      <UIcon :name="icon" class="size-7" />
    </div>
    <p class="font-medium text-default">{{ title }}</p>
    <p v-if="description" class="mt-1 text-sm text-muted max-w-sm mx-auto">{{ description }}</p>
    <div v-if="$slots.default" class="mt-5">
      <slot />
    </div>
  </div>
</template>
