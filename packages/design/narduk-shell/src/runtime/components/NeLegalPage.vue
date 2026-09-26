<script setup lang="ts">
/**
 * NeLegalPage — the layout for a terms, privacy or other legal page
 * (narduk-libs#388): `NePageHeader` for the title, a "Last updated" date
 * formatted through `./format`, a table of contents built from the sections,
 * then each section as an anchored `h2` and plain-text paragraphs.
 *
 * It ships no wording. Logan's decision on #388 was "Build, wording later":
 * the templates in `utils/legal-templates.ts` fill every body with a marked
 * placeholder, and no app goes live with a legal page until Logan approves
 * its wording in a separate issue. So this page is a **draft** unless the app
 * sets `wordingApproved` AND no section is still a placeholder — approval
 * cannot hide template text. A draft carries:
 *
 * - `data-ne-legal-status="draft"` on the root (else `"approved"`), for a
 *   test or a crawler check to read;
 * - a visible banner, `data-ne-legal-draft`, above the contents;
 * - `data-ne-legal-placeholder` and a dashed rule on each placeholder section;
 * - one development-only console warning naming the page.
 *
 * Bodies are rendered as text, never `v-html`. The `section` slot replaces a
 * body (not the heading or the anchor) for a page that needs lists or links.
 */
import { computed } from 'vue'

import { formatDate } from '../../format'

import { isLegalPlaceholder } from './ne-legal-page-types'
import NePageHeader from './NePageHeader.vue'

import type { NeDateInput } from '../../format'
import type { NeLegalPageProps, NeLegalSection } from './ne-legal-page-types'

const props = withDefaults(defineProps<NeLegalPageProps>(), {
  lastUpdated: undefined,
  timeZone: undefined,
  tocLabel: 'Contents',
  wordingApproved: false,
})

defineSlots<{
  /** Extra content after the last section, outside the table of contents. */
  default?(): unknown
  /** Replaces one section's body. The heading and anchor stay the page's. */
  section?(props: { section: NeLegalSection }): unknown
}>()

const CALENDAR_DATE = /^\d{4}-\d{2}-\d{2}$/

function isoOf(value: NeDateInput): string | undefined {
  if (value === null || value === undefined) return undefined
  if (typeof value === 'string' && CALENDAR_DATE.test(value)) return value
  const instant =
    value instanceof Date ? value.getTime() : typeof value === 'number' ? value : Date.parse(value)
  return Number.isFinite(instant) ? new Date(instant).toISOString() : undefined
}

/** `null` when there is nothing to show — never a "Last updated —". */
const updated = computed(() => {
  const datetime = isoOf(props.lastUpdated)
  if (datetime === undefined) return null
  // A calendar date prints as itself in any zone; an instant needs one.
  const timeZone = CALENDAR_DATE.test(datetime) ? 'UTC' : props.timeZone
  if (!timeZone) return null
  return { datetime, text: formatDate(props.lastUpdated, { timeZone }) }
})

const rows = computed(() =>
  props.sections.map((section) => ({
    headingId: `${section.id}-heading`,
    paragraphs: typeof section.body === 'string' ? [section.body] : [...section.body],
    placeholder: isLegalPlaceholder(section),
    section,
  })),
)

const hasPlaceholder = computed(() => rows.value.some((row) => row.placeholder))
const draft = computed(() => !props.wordingApproved || hasPlaceholder.value)

// Once per mount, from the props as first given: a nudge for the developer,
// not a reactive signal (the data attributes above are that).
if (import.meta.dev) {
  const placeholder = props.sections.some(isLegalPlaceholder)
  if (placeholder || !props.wordingApproved) {
    console.warn(
      `[narduk-shell] NeLegalPage "${props.title}" is a draft: ${
        placeholder ? 'it still renders placeholder legal wording' : 'wordingApproved is not set'
      }. Do not publish it until its wording is approved.`,
    )
  }
}
</script>

<template>
  <article
    data-ne-legal-page
    :data-ne-legal-status="draft ? 'draft' : 'approved'"
    class="ne-legal-page space-y-6"
  >
    <NePageHeader :title="title" />

    <p v-if="updated" data-ne-legal-updated class="text-sm text-muted">
      Last updated <time :datetime="updated.datetime">{{ updated.text }}</time>
    </p>

    <div
      v-if="draft"
      data-ne-legal-draft
      role="note"
      class="rounded border border-dashed border-default p-4 text-sm text-muted"
    >
      <p class="font-medium text-highlighted">Draft: not for publication.</p>
      <p>
        {{
          hasPlaceholder
            ? 'Sections marked placeholder still need approved wording.'
            : 'This page has not been marked as approved wording.'
        }}
      </p>
    </div>

    <nav v-if="rows.length > 0" :aria-label="tocLabel" class="ne-legal-page__toc text-sm">
      <p class="font-medium text-highlighted">{{ tocLabel }}</p>
      <ol class="mt-2 list-decimal space-y-1 pl-5">
        <li v-for="row in rows" :key="row.section.id">
          <a
            :href="`#${row.section.id}`"
            class="underline underline-offset-2 hover:text-highlighted"
          >
            {{ row.section.title }}
          </a>
        </li>
      </ol>
    </nav>

    <section
      v-for="row in rows"
      :id="row.section.id"
      :key="row.section.id"
      :aria-labelledby="row.headingId"
      :data-ne-legal-placeholder="row.placeholder ? 'true' : undefined"
      class="ne-legal-page__section space-y-2 scroll-mt-24"
      :class="row.placeholder ? 'border-l-2 border-dashed border-default pl-4' : undefined"
    >
      <h2 :id="row.headingId" class="text-base font-medium text-highlighted">
        {{ row.section.title }}
      </h2>
      <slot name="section" :section="row.section">
        <p
          v-for="(paragraph, index) in row.paragraphs"
          :key="index"
          class="text-sm"
          :class="row.placeholder ? 'italic text-muted' : 'text-default'"
        >
          {{ paragraph }}
        </p>
      </slot>
    </section>

    <slot />
  </article>
</template>
