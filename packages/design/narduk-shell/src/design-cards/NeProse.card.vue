<script setup lang="ts">
/*
 * NE Base design card for NeProse (narduk-libs#1005).
 *
 * One short runbook exercises every construct the subset reads, so a reviewer
 * sees the whole type ramp at once: the demoted h1, h2 and h3, a paragraph
 * with inline code, bold, italic and a link, a nested list, a fenced block, an
 * aligned table and a blockquote. The last row is the safety case: raw HTML
 * and a `javascript:` link render as text.
 */
import NeProse from '../runtime/components/NeProse.vue'

const runbook = [
  '# Rotate the API key',
  '',
  'Rotate the key **before** it expires. The current one is in `API_KEY`; see',
  'the [key policy](#policy) for *why* this is quarterly.',
  '',
  '## Steps',
  '',
  '1. Create the new key in the provider console.',
  '2. Store it:',
  '   - staging first',
  '   - then production',
  '3. Revoke the old key.',
  '',
  '```sh',
  'doppler secrets set API_KEY --config prd',
  '```',
  '',
  '### Expected lag',
  '',
  '| Region | Propagation | Retries |',
  '| :----- | :---------: | ------: |',
  '| us     | 30 s        | 2       |',
  '| eu     | 90 s        | 4       |',
  '',
  '> Never paste a key into a ticket.',
].join('\n')

const unsafe = 'Raw <b>markup</b> stays text, and [this link](javascript:alert(1)) has no href.'
</script>

<template>
  <section class="preview-card" data-design-card="ne-prose" data-name="Prose" data-group="Shell">
    <h2>Prose</h2>
    <p>
      A markdown document in the suite's type scale. The page header owns the h1, so a document's
      <code>#</code> renders as h2; every heading carries a slug id for a table of contents.
    </p>
    <div class="preview-row">
      <NeProse :source="runbook" />
    </div>
    <div class="preview-row">
      <NeProse :source="unsafe" />
    </div>
  </section>
</template>
