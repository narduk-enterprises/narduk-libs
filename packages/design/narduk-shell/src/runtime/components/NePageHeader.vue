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
 * Components-library backlog item 9 (narduk-libs#256); plan
 * docs/plans/components-library-plan.md §2 item 9.
 */
import UBreadcrumb, { type BreadcrumbItem } from '@nuxt/ui/components/Breadcrumb.vue'
import UPageHeader from '@nuxt/ui/components/PageHeader.vue'

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
  as?: string
  /** Breadcrumb trail. Rendered above the header, in a labelled `nav`, when non-empty. */
  breadcrumbs?: BreadcrumbItem[]
  /** Supporting copy shown below the title. */
  description?: string
  /** Small label shown above the title, e.g. a section or category name. */
  eyebrow?: string
  /** The page title. Rendered as the page's one `<h1>` by default. */
  title: string
}

withDefaults(defineProps<NePageHeaderProps>(), {
  description: undefined,
  eyebrow: undefined,
  breadcrumbs: undefined,
  as: 'h1',
})

defineSlots<{
  /** Right-aligned actions next to the title. Never rendered inside the heading element. */
  actions?(): unknown
  /** Extra content below the title/description block. */
  default?(): unknown
  /** Overrides the description text. */
  description?(): unknown
  /** Overrides the title text. Still rendered inside the heading element. */
  title?(): unknown
}>()
</script>

<template>
  <div>
    <nav v-if="breadcrumbs && breadcrumbs.length > 0" aria-label="Breadcrumb" class="mb-4">
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
         sibling of the heading in both paths, never nested inside it. -->
    <UPageHeader v-else :description="description">
      <template #headline>
        <p v-if="eyebrow" class="text-sm font-medium text-primary">{{ eyebrow }}</p>
        <component :is="as" class="mt-1 text-2xl font-semibold text-highlighted">
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
