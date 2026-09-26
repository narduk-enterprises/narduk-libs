<script setup lang="ts">
/**
 * NeProse — a markdown document rendered in the suite's type scale
 * (narduk-libs#1005): a runbook, a changelog entry, a help page.
 *
 * `source` goes through `parseProse()` (`../utils/prose.ts`), a small pure
 * parser for a markdown subset, and the resulting AST is rendered here node by
 * node with `h()`. There is no `v-html` anywhere on the path: every piece of
 * source text reaches the DOM as a text node, so raw HTML in the source is
 * shown, not run. The only source-derived attribute is a link's `href`, and it
 * passes `safeProseHref` again here, because `blocks` can be built by hand.
 *
 * h1 is never rendered — the page header owns it — so `#` is demoted to h2.
 * Every heading carries the unique slug id `parseProse` gave it; a page builds
 * its table of contents from the same AST with `proseOutline()`.
 *
 * A plain element with a scoped stylesheet of token reads, like NeMeter. The
 * rendered elements come from a render function rather than this template, so
 * the rules reach them through `:deep()` under the root class.
 */
import { computed, h } from 'vue'

import { parseProse, safeProseHref } from '../utils/prose'

import type { NeProseAlign, NeProseBlock, NeProseInline, NeProseProps } from './ne-prose-types'
import type { FunctionalComponent, VNodeChild } from 'vue'

const props = withDefaults(defineProps<NeProseProps>(), {
  blocks: undefined,
  source: '',
})

const tree = computed(() => props.blocks ?? parseProse(props.source))

function renderRuns(runs: readonly NeProseInline[]): VNodeChild[] {
  return runs.map((run) => renderInline(run))
}

function renderInline(run: NeProseInline): VNodeChild {
  switch (run.type) {
    case 'text': {
      return run.value
    }
    case 'break': {
      return h('br')
    }
    case 'code': {
      return h('code', run.value)
    }
    case 'strong': {
      return h('strong', renderRuns(run.children))
    }
    case 'em': {
      return h('em', renderRuns(run.children))
    }
    case 'link': {
      const href = safeProseHref(run.href)
      return href === null ? renderRuns(run.children) : h('a', { href }, renderRuns(run.children))
    }
  }
}

function alignStyle(align: NeProseAlign | undefined) {
  return align ? { textAlign: align } : undefined
}

function renderBlock(block: NeProseBlock): VNodeChild {
  switch (block.type) {
    case 'heading': {
      return h(`h${block.level}`, { id: block.id }, renderRuns(block.children))
    }
    case 'paragraph': {
      return h('p', renderRuns(block.children))
    }
    case 'list': {
      const items = block.items.map((item) => h('li', item.children.map(renderBlock)))
      return block.ordered
        ? h('ol', { start: block.start === 1 ? undefined : block.start }, items)
        : h('ul', items)
    }
    case 'code': {
      return h(
        'pre',
        { 'data-lang': block.lang ?? undefined },
        h('code', { class: block.lang ? `language-${block.lang}` : undefined }, block.value),
      )
    }
    case 'blockquote': {
      return h('blockquote', block.children.map(renderBlock))
    }
    case 'rule': {
      return h('hr')
    }
    case 'table': {
      return h('div', { class: 'ne-prose__table' }, [
        h('table', [
          h(
            'thead',
            h(
              'tr',
              block.head.map((cell, column) =>
                h('th', { scope: 'col', style: alignStyle(block.align[column]) }, renderRuns(cell)),
              ),
            ),
          ),
          h(
            'tbody',
            block.rows.map((row) =>
              h(
                'tr',
                row.map((cell, column) =>
                  h('td', { style: alignStyle(block.align[column]) }, renderRuns(cell)),
                ),
              ),
            ),
          ),
        ]),
      ])
    }
  }
}

const ProseBlocks: FunctionalComponent<{ blocks: readonly NeProseBlock[] }> = (nodeProps) =>
  nodeProps.blocks.map(renderBlock)
ProseBlocks.props = ['blocks']
</script>

<template>
  <div class="ne-prose" data-testid="ne-prose"><ProseBlocks :blocks="tree" /></div>
</template>

<style scoped>
/*
 * Token reads only (README § Styling contract): type sizes, leading and
 * tracking from the `--ne-text-*` scale, ink and lines from `--ne-*`. Spacing
 * is plain em/rem, as there is no NE space scale. The type hierarchy here is
 * the document's own — h2 at the section-heading size, h3 at body size — and
 * sits under the page header's h1.
 */
.ne-prose {
  min-width: 0;
  font-size: var(--ne-text-body);
  line-height: var(--ne-leading-body);
  color: var(--ne-ink-body);
  overflow-wrap: break-word;
}

.ne-prose > :deep(:first-child) {
  margin-top: 0;
}

.ne-prose > :deep(:last-child) {
  margin-bottom: 0;
}

.ne-prose :deep(:is(p, ul, ol, pre, blockquote, .ne-prose__table)) {
  margin: 0 0 1em;
}

.ne-prose :deep(h2) {
  margin: 1.75em 0 0.5em;
  font-size: var(--ne-text-heading);
  font-weight: 600;
  line-height: var(--ne-leading-tight);
  letter-spacing: var(--ne-tracking-tight);
  color: var(--ne-ink);
  scroll-margin-top: calc(var(--ne-header-height) + 1rem);
}

.ne-prose :deep(h3) {
  margin: 1.5em 0 0.5em;
  font-size: var(--ne-text-body);
  font-weight: 600;
  line-height: var(--ne-leading-tight);
  color: var(--ne-ink);
  scroll-margin-top: calc(var(--ne-header-height) + 1rem);
}

.ne-prose :deep(strong) {
  font-weight: 600;
  color: var(--ne-ink);
}

.ne-prose :deep(a) {
  color: var(--ne-accent);
  text-decoration: underline;
  text-underline-offset: 0.15em;
}

.ne-prose :deep(a:hover) {
  text-decoration-thickness: 2px;
}

.ne-prose :deep(:is(ul, ol)) {
  padding-inline-start: 1.5em;
}

.ne-prose :deep(ul) {
  list-style: disc;
}

.ne-prose :deep(ol) {
  list-style: decimal;
}

.ne-prose :deep(li > :is(p, ul, ol, pre, blockquote)) {
  margin: 0.25em 0;
}

.ne-prose :deep(li::marker) {
  color: var(--ne-ink-muted);
}

.ne-prose :deep(code) {
  padding: 0.1em 0.3em;
  font-family: var(--ne-font-mono);
  font-size: 0.9em;
  border-radius: var(--ne-radius-base);
  background-color: var(--ne-surface-muted);
  color: var(--ne-ink);
}

.ne-prose :deep(pre) {
  padding: 0.75rem 1rem;
  overflow-x: auto;
  font-size: var(--ne-text-small);
  line-height: var(--ne-leading-body);
  border: 1px solid var(--ne-hairline);
  border-radius: var(--ne-radius-control);
  background-color: var(--ne-surface-muted);
}

.ne-prose :deep(pre code) {
  padding: 0;
  font-size: inherit;
  background: none;
  white-space: pre;
}

.ne-prose :deep(blockquote) {
  padding-inline-start: 1rem;
  border-inline-start: 3px solid var(--ne-line-strong);
  color: var(--ne-ink-secondary);
}

.ne-prose :deep(hr) {
  margin: 2em 0;
  border: 0;
  border-top: 1px solid var(--ne-divider);
}

.ne-prose :deep(.ne-prose__table) {
  overflow-x: auto;
  border: 1px solid var(--ne-hairline);
  border-radius: var(--ne-radius-control);
}

.ne-prose :deep(table) {
  width: 100%;
  font-size: var(--ne-text-small);
  border-collapse: collapse;
}

.ne-prose :deep(:is(th, td)) {
  padding: 0.5rem 0.75rem;
  text-align: start;
  vertical-align: top;
  border-top: 1px solid var(--ne-divider);
}

.ne-prose :deep(th) {
  font-weight: 500;
  color: var(--ne-ink);
  border-top: 0;
  background-color: var(--ne-surface-muted);
}

@media (forced-colors: active) {
  .ne-prose :deep(:is(code, pre)) {
    border: 1px solid CanvasText;
  }
}
</style>
