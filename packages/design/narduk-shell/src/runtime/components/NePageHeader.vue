<script setup lang="ts">
/**
 * NePageHeader — the shared page-level header: an optional breadcrumb trail,
 * an eyebrow label, the page title, a description, and a right-aligned
 * actions area.
 *
 * Wraps Nuxt UI's `UPageHeader` (title/headline/description/links layout)
 * and `UBreadcrumb` (the trail). Components are imported explicitly from
 * `@nuxt/ui/components/*` rather than used as unimported global tags: this
 * package ships raw, uncompiled SFCs (src/module.ts's comment on
 * `build.transpile`), and an explicit import gives both a real prop/slot
 * type for `vue-tsc` and a stable module specifier tests can mock — neither
 * of which a bare `<UPageHeader>` tag has outside a running Nuxt app's own
 * component-resolution build step.
 *
 * Styling contract (narduk-ui guardrail 3, extended to the suite): this
 * file reads Nuxt UI semantic tokens (`text-primary`, `text-highlighted`)
 * and never hardcodes a colour, radius, shadow or font. UPageHeader owns
 * the default h1 treatment; the `as` override path only swaps the heading
 * element and keeps the same token classes.
 *
 * Components-library backlog item 9 (narduk-libs#256); plan
 * docs/plans/components-library-plan.md §2 item 9.
 */
import UBreadcrumb from '@nuxt/ui/components/Breadcrumb.vue'
import UPageHeader from '@nuxt/ui/components/PageHeader.vue'

export type NePageHeaderHeading = 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6'

/**
 * One trail entry in the UBreadcrumb item shape used by this wrapper
 * (`label`, optional `to` / `icon`). Extra UBreadcrumb fields are allowed
 * and forwarded on the items array.
 */
export interface NeBreadcrumbItem {
  [key: string]: unknown
  icon?: string
  label?: string
  to?: string
}

export interface NePageHeaderProps {
  /**
   * The heading tag rendered for the title. Default `'h1'` — use the default
   * when this is the page's own heading.
   *
   * Nuxt UI's `UPageHeader` always wraps its title in a literal `<h1>` with
   * no per-instance override, so honouring a non-default `as` (e.g. `'h2'`,
   * for a page that already has its own `h1` elsewhere — a dashboard widget,
   * a modal, a secondary header on the same page) means NePageHeader builds
   * that title itself instead of delegating to `UPageHeader`'s title slot,
   * to avoid nesting a second heading element inside the `<h1>`.
   */
  as?: NePageHeaderHeading
  /** Breadcrumb trail. Rendered above the title, in a labelled `nav`, when non-empty. */
  breadcrumbs?: NeBreadcrumbItem[]
  /** Supporting copy shown below the title. */
  description?: string
  /** Small label shown above the title, e.g. a section or category name. */
  eyebrow?: string
  /** The page title. Rendered as the page's one `<h1>` by default. */
  title: string
}

withDefaults(defineProps<NePageHeaderProps>(), {
  as: 'h1',
  breadcrumbs: undefined,
  description: undefined,
  eyebrow: undefined,
})

defineSlots<{
  /** Right-aligned actions next to the title. Never rendered inside the heading element. */
  actions?(): unknown
  /** Extra content below the title/description block. Pass-through of UPageHeader's default slot. */
  default?(): unknown
  /** Overrides the description text. */
  description?(): unknown
  /** Overrides the title text. Still rendered inside the heading element. */
  title?(): unknown
}>()
</script>

<template>
  <div>
    <nav v-if="breadcrumbs && breadcrumbs.length > 0" aria-label="Breadcrumb">
      <UBreadcrumb :items="breadcrumbs" aria-label="Breadcrumb" />
    </nav>

    <!-- Default path: `as` is 'h1', so UPageHeader's own title renders the
         page's one heading and everything (headline, description, links)
         comes from its native layout. -->
    <UPageHeader v-if="as === 'h1'" :title="title" :headline="eyebrow" :description="description">
      <template #title>
        <slot name="title">{{ title }}</slot>
      </template>
      <template v-if="description || $slots.description" #description>
        <slot name="description">{{ description }}</slot>
      </template>
      <template #links>
        <slot name="actions" />
      </template>
      <slot />
    </UPageHeader>

    <!-- Override path: build the heading ourselves at the requested level.
         Actions still go through UPageHeader's `links` slot, so they stay a
         sibling of the heading in both paths, never nested inside it.
         Token classes only — no hardcoded size, weight, colour or radius. -->
    <UPageHeader v-else :description="description">
      <template #headline>
        <p v-if="eyebrow" class="text-primary">{{ eyebrow }}</p>
        <component :is="as" class="text-highlighted">
          <slot name="title">{{ title }}</slot>
        </component>
      </template>
      <template v-if="description || $slots.description" #description>
        <slot name="description">{{ description }}</slot>
      </template>
      <template #links>
        <slot name="actions" />
      </template>
      <slot />
    </UPageHeader>
  </div>
</template>
