<script setup lang="ts">
/*
 * NE Base design card for NeMessageProse.
 *
 * Row one is what a lane hand-back looks like, formatted: a heading as a bold
 * line, a bold lead, a flattened list restored and inline code.
 * Row two is a long message with `clamp`: cut at four lines under a fade, with
 * Show more. Row three is the safety case: a marker cut mid-way, a relative,
 * `http:`, `javascript:` or `mailto:` link and raw HTML all render as text. No
 * card shows an `https:` link: the card build refuses every `href` that is not
 * a `#fragment`, and a message link is always external. Row four is
 * inline mode in a table-cell-sized box, ellipsised by its container.
 */
import NeMessageProse from '../runtime/components/NeMessageProse.vue'

const handback =
  '## Done\n\nThe work is finished. **Merged** `#1502` and closed the loop. Still open: - **Release:** the version PR is next. - **Portal:** a second lane moves it onto this.'

const long = [
  'The scan covered every repo. Findings:',
  '',
  '- one: the runner group was empty',
  '- two: a token expired on the 12th',
  '- three: a workflow pinned an old Node',
  '- four: a cache key never changed',
  '- five: a job ran twice per push',
  '- six: a label was missing',
].join('\n')

const hostile =
  'Cut mid-way: **bold that never closes and `code that never closes. [relative](docs/a.md), [http](http://example.test), [js](javascript:alert(1)), [mail](mailto:a@b.test) and <b>raw</b> stay text.'

const title = '**Rotate** the `API_KEY` before it *expires*'
</script>

<template>
  <section
    class="preview-card"
    data-design-card="ne-message-prose"
    data-name="Message prose"
    data-group="Shell"
  >
    <h2>Message prose</h2>
    <p>
      What an agent or a bot wrote, formatted. It takes its type, leading and ink from the place it
      sits in; only <code>https:</code> links stay links.
    </p>
    <div class="preview-row">
      <NeMessageProse :text="handback" />
    </div>
    <div class="preview-row">
      <NeMessageProse :text="long" :clamp="4" />
    </div>
    <div class="preview-row">
      <NeMessageProse :text="hostile" />
    </div>
    <div
      class="preview-row"
      style="max-width: 18rem; overflow: hidden; text-overflow: ellipsis; white-space: nowrap"
    >
      <NeMessageProse :text="title" mode="inline" />
    </div>
  </section>
</template>
