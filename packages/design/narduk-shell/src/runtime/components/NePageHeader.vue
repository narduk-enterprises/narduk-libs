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
 * Accessibility: the breadcrumb trail is rendered as ONE navigation landmark.
 * Nuxt UI's `Breadcrumb.vue` (4.6.0) is itself a `Primitive` rendered `as`
 * `"nav"` with `aria-label="breadcrumb"`, and an `aria-label` handed to the
 * component falls through onto that same root. This wrapper therefore renders
 * `UBreadcrumb` bare and only relabels it; an enclosing `<nav>` of its own put
 * two identically named landmarks on every page using the shared header, which
 * is a duplicate entry in every landmark and rotor list.
 *
 * Styling contract (narduk-ui guardrail 3, extended to the suite): this
 * file reads Nuxt UI semantic tokens (`text-primary`, `text-highlighted`)
 * and never hardcodes a colour, radius, shadow or font. UPageHeader owns
 * the default h1 treatment; the `as` override path only swaps the heading
 * element and keeps the same token classes.
 *
 * Three optional slots cover what a data-dense app's page head carries beyond
 * a title (portal-polish L1):
 *
 *   - `lead`    — a small control ahead of the title, typically a back link.
 *     It is placed in `UPageHeader`'s headline row, above the title and before
 *     the eyebrow, never inside the heading element.
 *   - `meta`    — a read-out about the page rather than an action: a clock or
 *     "as of" tag, a count, a status chip. It sits with the actions, ahead of
 *     them, and never inside the heading, so the page's accessible name stays
 *     the title alone.
 *   - `actions` — as before, right-aligned.
 *
 * Without `lead` and `meta` the markup is what it always was. On a phone the
 * actions row takes the full width, controls hold a 2.75rem tap floor and a long
 * title wraps instead of widening the page.
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
  /**
   * Breadcrumb trail. Rendered above the title when non-empty, as exactly one
   * `nav` landmark — `UBreadcrumb`'s own root, relabelled `Breadcrumb`.
   */
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
  /** A control ahead of the title, e.g. a back link. Above the title, never inside the heading element. */
  lead?(): unknown
  /** A read-out beside the actions, e.g. a clock tag. Never inside the heading element. */
  meta?(): unknown
  /** Overrides the title text. Still rendered inside the heading element. */
  title?(): unknown
}>()
</script>

<template>
  <div class="ne-page-header">
    <!-- Deliberately unwrapped: UBreadcrumb's own root is the navigation
         landmark, and the label below lands on it. See the header comment. -->
    <UBreadcrumb
      v-if="breadcrumbs && breadcrumbs.length > 0"
      :items="breadcrumbs"
      aria-label="Breadcrumb"
    />

    <!-- Default path: `as` is 'h1', so UPageHeader's own title renders the
         page's one heading and everything (headline, description, links)
         comes from its native layout. -->
    <UPageHeader v-if="as === 'h1'" :title="title" :headline="eyebrow" :description="description">
      <template v-if="$slots.lead" #headline>
        <span data-ne-page-header-lead class="ne-page-header__lead"><slot name="lead" /></span>
        <span v-if="eyebrow">{{ eyebrow }}</span>
      </template>
      <template #title>
        <slot name="title">{{ title }}</slot>
      </template>
      <template v-if="description || $slots.description" #description>
        <slot name="description">{{ description }}</slot>
      </template>
      <template #links>
        <span v-if="$slots.meta" data-ne-page-header-meta class="ne-page-header__meta"
          ><slot name="meta"
        /></span>
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
        <span v-if="$slots.lead" data-ne-page-header-lead class="ne-page-header__lead"
          ><slot name="lead"
        /></span>
        <p v-if="eyebrow" class="text-primary">{{ eyebrow }}</p>
        <component :is="as" class="text-highlighted">
          <slot name="title">{{ title }}</slot>
        </component>
      </template>
      <template v-if="description || $slots.description" #description>
        <slot name="description">{{ description }}</slot>
      </template>
      <template #links>
        <span v-if="$slots.meta" data-ne-page-header-meta class="ne-page-header__meta"
          ><slot name="meta"
        /></span>
        <slot name="actions" />
      </template>
      <slot />
    </UPageHeader>
  </div>
</template>

<style scoped>
/*
 * The phone layout. Nuxt UI's header already stacks title and links below `lg`;
 * what it does not do is make the stack comfortable on a 390px screen. Token
 * reads and plain rem only (README § Styling contract); `data-slot` is Nuxt
 * UI's documented styling hook for the header's parts.
 */
.ne-page-header__lead,
.ne-page-header__meta {
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  min-width: 0;
}

@media (max-width: 40rem) {
  .ne-page-header :deep([data-slot='root']) {
    padding-block: 1rem;
  }

  .ne-page-header :deep([data-slot='title']) {
    overflow-wrap: anywhere;
  }

  .ne-page-header :deep([data-slot='links']) {
    width: 100%;
  }

  .ne-page-header :deep([data-slot='links'] button),
  .ne-page-header :deep([data-slot='links'] a) {
    min-height: 2.75rem;
  }

  .ne-page-header__meta {
    flex: 1 1 100%;
    flex-wrap: wrap;
  }
}
</style>
