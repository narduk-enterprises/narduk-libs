/*
 * NE Base design cards ship with their component — components backlog item 3
 * (narduk-libs#250).
 *
 * Before this item, an NE Base card was a hand-written `<section>` in
 * `packages/design/design-system-build/app/app.vue`: a second place to edit,
 * in a different package, after the component was already done. Predictably,
 * the plan's done-when 3 was the one nothing enforced.
 *
 * A card now lives next to the component it previews, and this file is what
 * makes that a rule rather than a habit. It is deliberately a SERVER render:
 * design-system-build prerenders the gallery with `nuxt generate`, so a card
 * that only works once a browser has hydrated it produces an empty card in
 * NE Base while every DOM-based test stays green.
 */
import { describe, expect, it } from 'vitest'
import { createSSRApp, type Component } from 'vue'
import { renderToString } from 'vue/server-renderer'

import { PENDING_CARDS } from '../src/pending-cards'
import { NE_SHELL_COMPONENTS } from '../src/registry'
import { NE_SHELL_SURFACE_CARDS } from '../src/surface-cards'

/** `NeStatePanel` -> `ne-state-panel`; the id a card must declare. */
export function kebabCase(name: string): string {
  return name
    .replaceAll(/([a-z0-9])([A-Z])/g, '$1-$2')
    .replaceAll(/([A-Z]+)([A-Z][a-z])/g, '$1-$2')
    .toLowerCase()
}

type CardModule = { default: Component }
const named = (modules: Record<string, CardModule>) =>
  Object.entries(modules)
    .map(([path, module]) => ({
      file: path.slice(path.lastIndexOf('/') + 1),
      name: path.slice(path.lastIndexOf('/') + 1, -'.card.vue'.length),
      component: module.default,
    }))
    .sort((first, second) => first.name.localeCompare(second.name))

/** The discovered surface: exactly what design-system-build renders. */
const cards = named(import.meta.glob<CardModule>('../src/design-cards/*.card.vue', { eager: true }))
/** Not discovered by the renderer, but still proven to render and lint. */
const templates = named(
  import.meta.glob<CardModule>('../src/design-cards/template/*.card.vue', { eager: true }),
)

describe('every registered component has a card, and every card a component', () => {
  // Two lists may authorise a card, and only two: the component registry, and
  // `surface-cards.ts` for a card that previews an export subpath rather than
  // a component (`./format`, components backlog item 5). A card named by
  // neither is still an error, which is the half of this rule that matters --
  // NE Base showing a card for something no app can import.
  const surfaceNames = NE_SHELL_SURFACE_CARDS.map((card) => card.name)
  const authorised = [...NE_SHELL_COMPONENTS.map((component) => component.name), ...surfaceNames]
  const required = [...NE_SHELL_COMPONENTS]
    .map((component) => component.name)
    .filter((name) => !PENDING_CARDS.includes(name))
    .concat(surfaceNames)
    .sort()

  it('is not vacuous: PENDING_CARDS cannot swallow every registered component', () => {
    // `required` filters registered names through PENDING_CARDS. If the
    // registry is non-empty but PENDING_CARDS happens to list every one of
    // those names, `required` goes empty and the assertions below pass on
    // zero cards -- a green suite that proves nothing. Fail loudly instead,
    // the same way the check-component-surface fixtures make every rule a
    // real gate rather than one that can never fire.
    if (NE_SHELL_COMPONENTS.length > 0) {
      expect(required.length).toBeGreaterThan(0)
    }
  })

  it('matches the registry name for name, except reviewed pendingCards', () => {
    const cardNames = cards.map((card) => card.name)
    expect(cardNames.filter((name) => !PENDING_CARDS.includes(name))).toEqual(required)
    expect(new Set(cardNames).size).toBe(cardNames.length)
    for (const name of cardNames) {
      expect(authorised).toContain(name)
    }
  })

  it('keeps the surface-card list an exception, not a second registry', () => {
    // A name that is both a component and a surface card would render one card
    // id twice; `shellCardPlan` rejects that, and this is the near half of the
    // same rule. The cap is a judgement, not arithmetic: if this list ever
    // grows past a handful, the shape is wrong and a card belongs to something
    // the registry knows about.
    for (const name of surfaceNames) {
      expect(NE_SHELL_COMPONENTS.map((component) => component.name)).not.toContain(name)
    }
    expect(new Set(surfaceNames).size).toBe(surfaceNames.length)
    expect(surfaceNames.length).toBeLessThanOrEqual(3)
  })

  it('names each required card file after the component it previews', () => {
    for (const name of required) {
      expect(cards.map((card) => card.file)).toContain(`${name}.card.vue`)
    }
  })

  it('keeps the copyable template on disk, since the README tells lanes to copy it', () => {
    // A recipe that points at a missing file is worse than no recipe.
    expect(templates.map((card) => card.file)).toEqual(['NeExample.card.vue'])
  })
})

describe('cards server-render into the markup NE Base consumes', () => {
  for (const card of [...cards, ...templates]) {
    it(`${card.file} renders a card section without throwing`, async () => {
      const html = await renderToString(createSSRApp(card.component))
      // design-system-build's renderBundle keys every card off these three
      // attributes and rejects a section missing `data-name`/`data-group`.
      expect(html).toContain(`data-design-card="${kebabCase(card.name)}"`)
      expect(html).toMatch(/data-name="[^"]+"/)
      expect(html).toMatch(/data-group="[^"]+"/)
      // An empty render is a card that passes a smoke test and shows nothing.
      expect(html.length).toBeGreaterThan(120)
    })
  }

  it('gives every card a distinct id, because the renderer refuses duplicates', () => {
    const ids = [...cards, ...templates].map((card) => kebabCase(card.name))
    expect(new Set(ids).size).toBe(ids.length)
  })
})
